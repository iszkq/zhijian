from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pdfplumber
from import_complete_numeric_docx import extract_notes, marker_numbers, similarity, xml_paragraphs

TYPE = "【题型分类】"
PRACTICAL = "【实战解析】"
PRACTICAL_RE = re.compile(r"【\s*实\s*战\s*解\s*析[^】]*】")
ANSWER_Q = "【参考答案】"
ANSWER_D = "【参考答案及正确率】"
NOTE = "花生批注"
LABELS = "ABCDEFGH"
OPTION_RE = re.compile(r"(?:^|\n|\s{2,})([A-H])\s*[.．、]")


def compact(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\xa0", " ").replace("\t", " ")
    text = re.sub(r"[ \r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    return text.strip()


def pdf_text(path: Path) -> tuple[str, list[str]]:
    cache = path.with_suffix(".main-layout.txt")
    if cache.exists():
        text = cache.read_text(encoding="utf-8")
        return text, text.split("\n\f\n")
    with pdfplumber.open(path) as pdf:
        pages = []
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=2, y_tolerance=3, use_text_flow=False)
            has_left_note = any(
                NOTE in word["text"] and word["x0"] < page.width * 0.25
                for word in words
            )
            main_anchors = (TYPE, ANSWER_Q, ANSWER_D, PRACTICAL)
            has_right_main_body = any(
                any(anchor in word["text"] for anchor in main_anchors)
                and word["x0"] >= page.width * 0.30
                for word in words
            )
            has_left_note_column = has_left_note and has_right_main_body
            # The converted Word layout places peanut comments in a dedicated
            # left column.  Reading the whole page interleaves those comments
            # with the question stem and options.  On pages that have this
            # column, retain only the physical main body on the right.
            source = page.crop((page.width * 0.23, 0, page.width, page.height)) if has_left_note_column else page
            pages.append(source.extract_text(x_tolerance=2, y_tolerance=3, layout=True) or "")
    text = "\n\f\n".join(pages)
    cache.write_text(text, encoding="utf-8")
    return text, pages


def find_question_starts(text: str, type_positions: list[int], kind: str) -> list[int]:
    starts: list[int] = []
    for index, type_at in enumerate(type_positions):
        expected = index % 10 + 1 if kind == "quantity" else index + 1
        lower = type_positions[index - 1] + len(TYPE) if index else 0
        region = text[lower:type_at]
        pattern = re.compile(rf"(?:^|\n)\s*{expected}\s*[.．、]\s*")
        matches = list(pattern.finditer(region))
        if not matches:
            pattern = re.compile(rf"(?<!\d){expected}\s*[.．、]\s*")
            matches = list(pattern.finditer(region))
        if not matches:
            # A handful of numbers are vector glyphs. Search a wider window;
            # the type anchor and sequential index still identify the record.
            lower = type_positions[max(0, index - 3)] + len(TYPE) if index else 0
            region = text[lower:type_at]
            matches = list(re.compile(rf"(?:^|\n)\s*{expected}\s*[.．、]\s*").finditer(region))
        if not matches:
            # If the number itself is a vector glyph, the prior solution's
            # “答案为X选项” is the strongest textual boundary.
            previous_end = list(re.finditer(r"答案\s*(?:只能)?为\s*[A-H]\s*选项[^\n。]*[。.]?", region))
            if previous_end:
                starts.append(lower + previous_end[-1].end())
                continue
            raise ValueError(f"第 {index + 1} 题未找到题号 {expected}（题型锚点 {type_at}）")
        # The real question is the latest expected number before its own type.
        starts.append(lower + matches[-1].start() + (1 if matches[-1].group(0).startswith("\n") else 0))
    return starts


def option_spans(text: str) -> list[re.Match[str]]:
    matches = list(OPTION_RE.finditer(text))
    result: list[re.Match[str]] = []
    expected = "A"
    for match in matches:
        if match.group(1) != expected:
            continue
        result.append(match)
        expected = chr(ord(expected) + 1)
    return result if len(result) >= 4 else []


def parse_question_content(block: str, answer_label: str) -> tuple[str, list[dict], list[str]]:
    head = re.match(r"\s*\d{1,3}\s*[.．、]\s*", block)
    body = block[head.end():] if head else block
    body = re.sub(r"^\s*[（(][^）)\n]{0,80}[）)]\s*", "", body, count=1)
    answer_at = body.find(answer_label)
    if answer_at < 0:
        answer_at = body.find(TYPE)
    before_answer = body[:answer_at if answer_at >= 0 else len(body)]
    spans = option_spans(before_answer)
    missing: list[str] = []
    if len(spans) != 4:
        stem = compact(before_answer)
        labels = "ABCD"
        options = [{"label": label, "content": "（图形选项，见题目原图）"} for label in labels]
        return stem, options, list(labels)
    stem = compact(before_answer[:spans[0].start()])
    options: list[dict] = []
    for i, match in enumerate(spans):
        end = spans[i + 1].start() if i + 1 < len(spans) else len(before_answer)
        content = compact(before_answer[match.end():end])
        # Notes are a separate column and must not become option D text.
        note_at = content.find(NOTE)
        if note_at >= 0:
            content = content[:note_at].strip()
        if not content:
            missing.append(match.group(1))
            content = "（图形选项，见题目原图）"
        options.append({"label": match.group(1), "content": content})
    return stem, options, missing


def normalize_type(raw: str, kind: str) -> str:
    raw = compact(raw).split("【", 1)[0].strip()
    if kind == "quantity":
        return raw or "数量关系"
    for token, label in [
        ("基期", "基期"), ("增长量", "增长量"), ("增量", "增长量"),
        ("增长率", "增长率"), ("增速", "增长率"), ("比重", "比重"),
        ("综合", "综合分析"), ("推出", "综合分析"),
    ]:
        if token in raw:
            return label
    return raw or "资料分析"


def clean_explanation(text: str) -> str:
    practical = PRACTICAL_RE.search(text)
    if practical:
        text = text[practical.end():]
    else:
        # Some Word conversions omit the label but retain the solution after difficulty.
        text = re.sub(r"^.*?【难度评价】[^\n]*", "", text, count=1, flags=re.S)
    text = re.split(r"(?:①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|⑪|⑫|⑬|⑭|⑮|⑯|⑰|⑱|⑲|⑳)?\s*花生批注\s*[：:]", text, maxsplit=1)[0]
    text = re.sub(r"(?:四海公考|SIHAI\s*GONG\s*KAO|公考最新资料[^\n]*)", "", text, flags=re.I)
    return compact(text)


def fallback_explanation(stem: str, paragraphs) -> str:
    key = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", stem)[:28]
    if len(key) < 10:
        return ""
    start = None
    for i, paragraph in enumerate(paragraphs):
        value = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", paragraph.text)
        if len(value) >= 10 and (key in value or value[:28] in key):
            start = i
            break
    if start is None:
        return ""
    practical_at = None
    for i in range(start, min(len(paragraphs), start + 90)):
        if PRACTICAL_RE.search(paragraphs[i].text):
            practical_at = i
            break
    if practical_at is None:
        return ""
    parts: list[str] = []
    for i in range(practical_at, min(len(paragraphs), practical_at + 50)):
        value = paragraphs[i].text
        if i == practical_at:
            value = PRACTICAL_RE.split(value, maxsplit=1)[-1]
        elif re.match(r"^\s*\d{1,2}\s*[.．、]\s*", value):
            break
        if NOTE in value:
            value = value.split(NOTE, 1)[0]
            if value.strip():
                parts.append(value)
            break
        if value.strip():
            parts.append(value)
    return compact("\n".join(parts))


def xml_rich_stem(stem: str, paragraphs):
    key = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", stem)[:26]
    if len(key) < 10:
        return [{"text": stem}]
    for i, paragraph in enumerate(paragraphs):
        value = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", paragraph.text)
        if len(value) >= 10 and key in value:
            result = []
            for j in range(i, min(i + 8, len(paragraphs))):
                if j > i and re.search(r"(?:^|\s)A\s*[.．、]", paragraphs[j].text):
                    break
                if result:
                    result.append({"text": "\n"})
                result.extend(paragraphs[j].rich or [{"text": paragraphs[j].text}])
            return result or [{"text": stem}]
    return [{"text": stem}]


def parse_layout(path: Path, kind: str, category_id: int, id_base: int, docx: Path | None = None) -> tuple[list[dict], dict]:
    text, pages = pdf_text(path)
    xml = xml_paragraphs(docx) if docx else []
    type_positions = [match.start() for match in re.finditer(re.escape(TYPE), text)]
    if len(type_positions) != 600:
        raise ValueError(f"{path.name}：题型锚点 {len(type_positions)}，应为 600")
    starts = find_question_starts(text, type_positions, kind)
    answer_label = ANSWER_Q if kind == "quantity" else ANSWER_D
    records: list[dict] = []
    inferred_answers = 0
    missing_answers = 0
    graphical = 0
    missing_practical = 0
    for index, (start, type_at) in enumerate(zip(starts, type_positions)):
        next_start = starts[index + 1] if index + 1 < 600 else len(text)
        question_block = text[start:type_at]
        post_type = text[type_at + len(TYPE):next_start]
        stem, options, missing_options = parse_question_content(question_block, answer_label)
        explicit = re.search(re.escape(answer_label) + r"\s*([A-Ha-h])", question_block)
        inferred = re.search(r"答案\s*(?:只能)?为\s*([A-H])\s*选项", post_type)
        if explicit:
            answer = explicit.group(1).upper()
        elif inferred:
            answer = inferred.group(1)
            inferred_answers += 1
        else:
            # Also accept common wording: “选择/对应/锁定 X 选项”.
            inferred = re.search(r"(?:选择|对应|锁定|故选)\s*([A-H])\s*选项?", post_type)
            if not inferred:
                answer = ""
                missing_answers += 1
            else:
                answer = inferred.group(1)
                inferred_answers += 1
        type_line = post_type.split("\n", 1)[0]
        explanation = clean_explanation(post_type)
        if not explanation and xml:
            explanation = fallback_explanation(stem, xml)
        if not explanation:
            # Layout-only output is also used as a clean stem/option recovery
            # source.  The XML-anchored importer remains authoritative for a
            # solution when a page boundary obscures the layout label.
            missing_practical += 1
        if missing_options:
            graphical += 1
        expected = index % 10 + 1 if kind == "quantity" else index + 1
        details = {
            "globalNumber": index + 1,
            "sourceNumber": expected,
            "typeLabel": compact(type_line),
            "practicalAnalysis": explanation,
            "notes": [],
            "pairingMode": "word-rendered-layout-and-type-anchor",
            "missingOptionLabels": missing_options,
        }
        stem_rich = xml_rich_stem(stem, xml) if xml else [{"text": stem}]
        records.append({
            "id": id_base + index + 1,
            "categoryId": category_id,
            "type": normalize_type(type_line, kind),
            "stem": stem,
            "options": options,
            "answer": answer,
            "explanation": explanation,
            "source": "数量关系600题" if kind == "quantity" else "资料分析600题",
            "difficulty": "进阶",
            "status": "published",
            "details": details,
        })
    return records, {"pages": len(pages), "typeAnchors": len(type_positions), "inferredAnswers": inferred_answers, "missingAnswers": missing_answers, "graphicalQuestions": graphical, "missingPractical": missing_practical}


def parse_data_by_answers(path: Path, docx: Path | None = None) -> tuple[list[dict], dict]:
    text, pages = pdf_text(path)
    xml = xml_paragraphs(docx) if docx else []
    answer_pattern = re.compile(r"【\s*参考答案及正确率\s*】\s*([A-Da-d])")
    answers = list(answer_pattern.finditer(text))
    if len(answers) != 600:
        raise ValueError(f"{path.name}：答案锚点 {len(answers)}，应为600")
    starts: list[int] = []
    for index, answer in enumerate(answers):
        lower = answers[index - 1].end() if index else 0
        region = text[lower:answer.start()]
        expected = index % 20 + 1
        matches = list(re.finditer(rf"(?:^|\n)\s*{expected}\s*[.．、]\s*", region))
        if not matches:
            matches = list(re.finditer(rf"(?<!\d){expected}\s*[.．、]\s*", region))
        if matches:
            starts.append(lower + matches[-1].start() + (1 if matches[-1].group(0).startswith("\n") else 0))
            continue
        # Number rendered as a vector: use the end of the previous solution.
        boundary = list(re.finditer(r"答案\s*(?:只能)?为\s*[A-D]\s*选项[^\n。]*[。.]?", region))
        if not boundary:
            raise ValueError(f"第{expected}题未找到题号")
        starts.append(lower + boundary[-1].end())
    records, graphical, fallback_types, fallback_practical = [], 0, 0, 0
    type_re = re.compile(r"【\s*题型分类\s*】\s*([^\n【]+)")
    for index, (start, answer) in enumerate(zip(starts, answers)):
        next_start = starts[index + 1] if index + 1 < 600 else len(text)
        question_block = text[start:answer.end()]
        post = text[answer.end():next_start]
        stem, options, missing = parse_question_content(question_block, ANSWER_D)
        raw_type_match = type_re.search(post)
        raw_type = compact(raw_type_match.group(1)) if raw_type_match else ""
        if not raw_type:
            raw_type = "资料分析"
            fallback_types += 1
        practical = clean_explanation(post)
        if (not practical or PRACTICAL_RE.search(post) is None) and xml:
            fallback = fallback_explanation(stem, xml)
            if fallback:
                practical = fallback
                fallback_practical += 1
        if not practical:
            raise ValueError(f"第{index + 1}题实战解析缺失：{stem[:80]}")
        if missing:
            graphical += 1
        stem_rich = xml_rich_stem(stem, xml) if xml else [{"text": stem}]
        records.append({
            "id": 600001 + index, "categoryId": 5, "type": normalize_type(raw_type, "data"),
            "stem": stem, "options": options, "answer": answer.group(1).upper(),
            "explanation": practical, "source": "资料分析600题", "difficulty": "进阶", "status": "published",
            "details": {"globalNumber": index + 1, "sourceNumber": index % 20 + 1, "typeLabel": raw_type,
                        "practicalAnalysis": practical, "notes": [], "missingOptionLabels": missing,
                        "stemRich": stem_rich, "annotatedStemRich": stem_rich,
                        "pairingMode": "word-rendered-answer-anchor"}
        })
    attached = unbound = 0
    if xml:
        for position, marker, content, number in extract_notes(xml):
            approx = min(599, max(0, round(position / max(1, len(xml) - 1) * 599)))
            pool = records[max(0, approx - 35):min(600, approx + 36)]
            eligible = [q for q in pool if number is not None and number in marker_numbers(q["stem"] + " " + q["explanation"])]
            ranked = sorted(((similarity(content, q["stem"] + " " + q["explanation"]), q) for q in (eligible or pool)), key=lambda x: x[0], reverse=True)
            if not ranked or (not eligible and ranked[0][0] < 0.08):
                unbound += 1
                continue
            score, question = ranked[0]
            question["details"]["notes"].append({"marker": marker, "text": compact(content), "matchScore": round(score, 3)})
            attached += 1
        for question in records:
            notes = question["details"]["notes"]
            question["explanation"] = "\n\n".join([question["explanation"], *[f"{n['marker']}花生批注：\n{n['text']}" for n in notes]])
    return records, {"pages": len(pages), "answers": len(answers), "fallbackTypes": fallback_types,
                     "fallbackPractical": fallback_practical, "graphicalQuestions": graphical,
                     "notesAttached": attached, "notesUnbound": unbound}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--kind", choices=["quantity", "data"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--docx", type=Path)
    args = parser.parse_args()
    if args.kind == "data":
        records, report = parse_data_by_answers(args.pdf, args.docx)
    else:
        records, report = parse_layout(args.pdf, args.kind, 4, 500000, args.docx)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"questions": records, "report": report}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"count": len(records), **report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
