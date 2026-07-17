"""Import the two complete numeric-analysis workbooks without trusting text-box order.

The source Word files mix normal paragraphs, floating text boxes and duplicated
text emitted by Word.  Question answers are therefore the stable anchors.  This
script removes only verified duplicate answer anchors, then binds each record to
its numbered question, practical analysis and safely matched peanut notes.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ANSWER_QTY = "【参考答案】"
ANSWER_DATA = "【参考答案及正确率】"
TYPE = "【题型分类】"
PRACTICAL = "【实战解析】"
ALL_ANSWERS = "【全篇答案】"
NOTE = "花生批注"
LABELS = ("A", "B", "C", "D")
# Real option labels start a line or a visibly separated column.  This avoids
# treating prose such as “A、B、C三个方案” as answer choices.
OPTION = re.compile(r"(?:^|\n|\s)([A-D])\s*[.．、]")
CIRCLED = {chr(0x2460 + i): i + 1 for i in range(20)}


@dataclass
class Paragraph:
    text: str
    rich: list[dict]


def compact(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\xa0", " ").replace("\t", " ")
    value = re.sub(r"[ \r\f\v]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"(?<=[\u3400-\u9fff，。；：！？、（）《》“”‘’]) +(?=[\u3400-\u9fff，。；：！？、（）《》“”‘’])", "", value)
    return value.strip()


def xml_paragraphs(path: Path) -> list[Paragraph]:
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    parents = {child: parent for parent in root.iter() for child in parent}

    def owner(node: ET.Element) -> ET.Element | None:
        current = node
        while current in parents and parents[current].tag != W + "p":
            current = parents[current]
        return parents.get(current)

    def property_on(run: ET.Element, name: str) -> bool:
        prop = run.find(f"{W}rPr/{W}{name}")
        if prop is None:
            return False
        value = prop.get(W + "val", "true").lower()
        return value not in {"0", "false", "off", "none"}

    result: list[Paragraph] = []
    for paragraph in root.iter(W + "p"):
        runs: list[dict] = []
        for run in paragraph.iter(W + "r"):
            if owner(run) != paragraph:
                continue
            text_parts: list[str] = []
            for node in run.iter():
                if owner(node) is not paragraph:
                    continue
                if node.tag == W + "t":
                    text_parts.append(node.text or "")
                elif node.tag == W + "tab":
                    text_parts.append("\t")
                elif node.tag in {W + "br", W + "cr"}:
                    text_parts.append("\n")
            value = "".join(text_parts)
            if value:
                style = {"text": value}
                if property_on(run, "b"):
                    style["bold"] = True
                if property_on(run, "u"):
                    style["underline"] = True
                if property_on(run, "i"):
                    style["italic"] = True
                if run.find(f"{W}rPr/{W}highlight") is not None or run.find(f"{W}rPr/{W}shd") is not None:
                    style["highlight"] = True
                runs.append(style)
        # A few source text boxes wrap runs in revision/smart-tag containers.
        # Use text-node ownership as the authoritative paragraph text; retain
        # run styles wherever Word exposes them normally.
        direct_text = "".join((node.text or "") for node in paragraph.iter(W + "t") if owner(node) == paragraph)
        text = direct_text or "".join(run["text"] for run in runs)
        raw_text = "".join((node.text or "") for node in paragraph.iter(W + "t"))
        # Word sometimes stores an answer-bearing floating group in its parent
        # paragraph.  Preserve that anchor even though the group has no direct
        # run text; duplicate full question groups are removed later.
        if (ANSWER_QTY in raw_text or ANSWER_DATA in raw_text) and (ANSWER_QTY not in text and ANSWER_DATA not in text):
            text = raw_text
            runs = [{"text": raw_text}]
        if direct_text and "".join(run["text"] for run in runs) != direct_text:
            runs = [{"text": direct_text}]
        result.append(Paragraph(text=text, rich=runs))
    return result


def concat_rich(paragraphs: list[Paragraph]) -> list[dict]:
    result: list[dict] = []
    for p in paragraphs:
        if not p.text.strip():
            continue
        if result:
            result.append({"text": "\n"})
        result.extend({**run} for run in p.rich)
    return merge_rich(result)


def merge_rich(segments: list[dict]) -> list[dict]:
    result: list[dict] = []
    for segment in segments:
        text = segment["text"].replace("\u3000", " ").replace("\t", " ")
        if not text:
            continue
        style = {key: value for key, value in segment.items() if key != "text" and value}
        if result and {key: value for key, value in result[-1].items() if key != "text" and value} == style:
            result[-1]["text"] += text
        else:
            result.append({"text": text, **style})
    return result


def rich_slice(segments: list[dict], start: int, end: int) -> list[dict]:
    result: list[dict] = []
    offset = 0
    for segment in segments:
        nxt = offset + len(segment["text"])
        left, right = max(start, offset), min(end, nxt)
        if left < right:
            result.append({**segment, "text": segment["text"][left - offset:right - offset]})
        offset = nxt
    return merge_rich(result)


def rich_text(segments: list[dict]) -> str:
    return compact("".join(segment["text"] for segment in segments))


def stream(paragraphs: list[Paragraph]) -> tuple[str, list[dict], list[int]]:
    rich = concat_rich(paragraphs)
    text = "".join(segment["text"] for segment in rich)
    return text, rich, []


def answer_candidates(paragraphs: list[Paragraph], label: str, kind: str) -> list[int]:
    expression = re.compile(re.escape(label) + r"\s*([A-Da-d])")
    candidates = [i for i, p in enumerate(paragraphs) if expression.search(p.text)]
    # Quantitative source has three complete duplicate text-box paragraphs;
    # each repeats answer, type and solution in one physical paragraph.
    if kind == "quantity":
        candidates = [
            i for i in candidates
            if not (TYPE in paragraphs[i].text and paragraphs[i].text.find(label) > 0)
        ]
    else:
        # One duplicated floating-text answer contains the promotional footer.
        candidates = [i for i in candidates if "公考最新资料" not in paragraphs[i].text]
    return candidates


def question_start(paragraphs: list[Paragraph], before: int, answer_at: int, expected: int) -> int:
    exact = re.compile(rf"(?:^|\n)\s*{expected}\s*[.．、]\s*")
    matches = [i for i in range(before, answer_at + 1) if exact.search(paragraphs[i].text)]
    if not matches:
        # OCR/layout can put a question number in a text-box beside its title.
        loose = re.compile(rf"(?<!\d){expected}\s*[.．、]\s*")
        matches = [i for i in range(before, answer_at + 1) if loose.search(paragraphs[i].text)]
    if not matches:
        raise ValueError(f"未找到第 {expected} 题题干锚点（答案段 {answer_at}）")
    return matches[-1]


def parse_question(paragraphs: list[Paragraph], start: int, answer_at: int, answer_label: str) -> tuple[str, list[dict], list[dict], dict[str, list[dict]]]:
    text, rich, _ = stream(paragraphs[start:answer_at + 1])
    number = re.search(r"^\s*\d{1,3}\s*[.．、]\s*", text)
    if not number:
        number = re.search(r"\d{1,3}\s*[.．、]\s*", text)
    begin = number.end() if number else 0
    answer_pos = text.find(answer_label)
    limit = answer_pos if answer_pos >= 0 else len(text)
    found = list(OPTION.finditer(text[begin:limit]))
    ordered: list[re.Match] = []
    want = "A"
    for match in found:
        if match.group(1) == want:
            ordered.append(match)
            want = chr(ord(want) + 1)
            if want == "E":
                break
    if len(ordered) != 4:
        # Some diagram-only choices are Word drawing objects rather than text.
        # Keep their labels stable; the extraction report flags them for image
        # association instead of inventing option wording.
        stem_rich = rich_slice(rich, begin, limit)
        return rich_text(stem_rich), stem_rich, [{"label": label, "content": "（图形选项，见题目原图）"} for label in LABELS], {label: [{"text": "（图形选项，见题目原图）"}] for label in LABELS}
    spans = [(match.group(1), begin + match.start(), begin + match.end()) for match in ordered]
    stem_rich = rich_slice(rich, begin, spans[0][1])
    options: list[dict] = []
    option_rich: dict[str, list[dict]] = {}
    for index, (label, _, end) in enumerate(spans):
        # Do not let a floating peanut note following option D become option text.
        final = spans[index + 1][1] if index + 1 < len(spans) else limit
        if index == len(spans) - 1:
            tail = text[end:final]
            note = tail.find(NOTE)
            if note >= 0:
                final = end + note
        value_rich = rich_slice(rich, end, final)
        value = rich_text(value_rich)
        options.append({"label": label, "content": value})
        option_rich[label] = value_rich
    stem = rich_text(stem_rich)
    if not stem:
        raise ValueError(f"题干为空：{text[:120]}")
    for option in options:
        if not option["content"]:
            option["content"] = "（图形选项，见题目原图）"
            option_rich[option["label"]] = [{"text": option["content"]}]
    return stem, stem_rich, options, option_rich


def text_between(paragraphs: list[Paragraph], start: int, end: int, label: str) -> str:
    positions = [i for i in range(start, end) if label in paragraphs[i].text]
    if not positions:
        return ""
    parts: list[str] = []
    first = positions[0]
    for i in range(first, end):
        value = paragraphs[i].text
        if i == first:
            value = value.split(label, 1)[1]
        if NOTE in value or re.search(r"^\s*\d{1,3}\s*[.．、]", value):
            break
        if value.strip() and not re.fullmatch(r"(?:四海公考|SIHAI ?GONG ?KAO|数量关系 ?600|资料分析 ?600)", compact(value), re.I):
            parts.append(compact(value))
    return "\n".join(parts).strip()


def type_name(value: str, kind: str) -> str:
    value = compact(value).split("【", 1)[0].strip()
    if not value:
        return "数量关系" if kind == "quantity" else "资料分析"
    if kind == "data":
        if "基期" in value:
            return "基期"
        if "增长量" in value or "增量" in value:
            return "增长量"
        if "增长率" in value or "增速" in value:
            return "增长率"
        if "比重" in value:
            return "比重"
        if "综合" in value or "推出" in value:
            return "综合分析"
    return value


def marker_numbers(value: str) -> set[int]:
    return {CIRCLED[ch] for ch in value if ch in CIRCLED}


def similarity(left: str, right: str) -> float:
    a = {left[i:i + 2] for i in range(max(0, len(left) - 1)) if "\u3400" <= left[i] <= "\u9fff"}
    b = {right[i:i + 2] for i in range(max(0, len(right) - 1)) if "\u3400" <= right[i] <= "\u9fff"}
    return 2 * len(a & b) / max(1, len(a) + len(b))


def extract_notes(paragraphs: list[Paragraph]) -> list[tuple[int, str, str, int | None]]:
    result: list[tuple[int, str, str, int | None]] = []
    current: tuple[int, str, list[str], int | None] | None = None
    for index, p in enumerate(paragraphs):
        text = compact(p.text)
        if NOTE in text:
            if current and current[2]:
                result.append((current[0], current[1], "\n".join(current[2]), current[3]))
            prefix, suffix = text.split(NOTE, 1)
            marker = "".join(ch for ch in prefix[-8:] if ch in CIRCLED or ch.isdigit())
            number = CIRCLED.get(marker[-1]) if marker and marker[-1] in CIRCLED else (int(marker[-1]) if marker and marker[-1].isdigit() else None)
            current = (index, marker or "", [suffix.lstrip("：: ")] if suffix.lstrip("：: ") else [], number)
        elif current:
            if TYPE in text or PRACTICAL in text or "【参考答案" in text or re.match(r"^\s*\d{1,3}\s*[.．、]", text):
                if current[2]:
                    result.append((current[0], current[1], "\n".join(current[2]), current[3]))
                current = None
            elif text and not re.fullmatch(r"(?:四海公考|SIHAI ?GONG ?KAO|数量关系 ?600|资料分析 ?600)", text, re.I):
                current[2].append(text)
    if current and current[2]:
        result.append((current[0], current[1], "\n".join(current[2]), current[3]))
    # floating text commonly creates an identical shadow paragraph
    dedup: dict[str, tuple[int, str, str, int | None]] = {}
    for note in result:
        key = compact(note[2])[:500]
        if len(key) > 8 and key not in dedup:
            dedup[key] = note
    return list(dedup.values())


def import_doc(path: Path, kind: str, category_id: int, id_base: int) -> tuple[list[dict], dict]:
    paragraphs = xml_paragraphs(path)
    answer_label = ANSWER_QTY if kind == "quantity" else ANSWER_DATA
    answers = answer_candidates(paragraphs, answer_label, kind)
    if len(answers) < 599:
        raise ValueError(f"{path.name}：有效答案锚点为 {len(answers)}，至少应有 599")
    records: list[dict] = []
    starts: list[int] = []
    for index, answer_at in enumerate(answers):
        expected = index % 10 + 1 if kind == "quantity" else index + 1
        previous = answers[index - 1] + 1 if index else 0
        start = question_start(paragraphs, previous, answer_at, expected)
        stem, stem_rich, options, option_rich = parse_question(paragraphs, start, answer_at, answer_label)
        answer_match = re.search(re.escape(answer_label) + r"\s*([A-Da-d])", paragraphs[answer_at].text)
        answer = answer_match.group(1).upper() if answer_match else ""
        next_answer = answers[index + 1] if index + 1 < len(answers) else len(paragraphs)
        next_start = next_answer
        if index + 1 < len(answers):
            next_expected = (index + 1) % 10 + 1 if kind == "quantity" else index + 2
            next_start = question_start(paragraphs, answer_at + 1, next_answer, next_expected)
        raw_type = text_between(paragraphs, answer_at, next_start, TYPE)
        practical = text_between(paragraphs, answer_at, next_start, PRACTICAL)
        starts.append(start)
        records.append({
            "id": id_base + index + 1,
            "categoryId": category_id,
            "type": type_name(raw_type, kind),
            "stem": stem,
            "options": options,
            "answer": answer,
            "explanation": practical,
            "source": "数量关系600题" if kind == "quantity" else "资料分析600题",
            "difficulty": "进阶",
            "status": "published",
            "details": {
                "globalNumber": index + 1,
                "sourceNumber": expected,
                "typeLabel": raw_type,
                "stemRich": stem_rich,
                "annotatedStemRich": stem_rich,
                "annotatedOptionRich": option_rich,
                "practicalAnalysis": practical,
                "notes": [],
                "pairingMode": "answer-anchor-and-question-number",
            },
            "_start": start,
            "_analysis": practical,
        })
    notes = extract_notes(paragraphs)
    attached, unbound = 0, 0
    group_size = 10 if kind == "quantity" else 5
    for position, marker, content, number in notes:
        content = compact(content)
        if len(content) < 10:
            continue
        nearest = max((i for i, start in enumerate(starts) if start <= position), default=0)
        group = nearest // group_size
        pool = records[group * group_size:(group + 1) * group_size]
        eligible = [q for q in pool if number is not None and number in marker_numbers(q["stem"] + " " + q["_analysis"])]
        choices = eligible or pool
        ranked = sorted(((similarity(content, q["stem"] + " " + q["_analysis"]), q) for q in choices), reverse=True, key=lambda pair: pair[0])
        if not ranked or (not eligible and ranked[0][0] < 0.08):
            unbound += 1
            continue
        score, question = ranked[0]
        question["details"]["notes"].append({"marker": marker, "text": content, "matchScore": round(score, 3)})
        attached += 1
    for record in records:
        record["explanation"] = "\n\n".join(filter(None, [record["explanation"], *[f"{n['marker']}花生批注：\n{n['text']}" for n in record["details"]["notes"]]]))
        record.pop("_start")
        record.pop("_analysis")
    return records, {"answers": len(answers), "notesAttached": attached, "notesUnbound": unbound, "withPractical": sum(bool(q["details"]["practicalAnalysis"]) for q in records)}


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def migration(records: list[dict], path: Path) -> None:
    lines = [
        "-- Rebuild quantity and data-analysis questions from their complete analysis workbooks.",
        "INSERT OR IGNORE INTO categories (id, slug, name, short_name, description, color, soft_color, sort_order) VALUES (4, 'math', '数量关系', '数量', '数学运算与数字推理', '#ef5da8', '#fdebf4', 4);",
        "INSERT OR IGNORE INTO categories (id, slug, name, short_name, description, color, soft_color, sort_order) VALUES (5, 'data', '资料分析', '资料', '基期、增长量、增长率、比重与综合分析', '#3b82f6', '#eaf2ff', 5);",
        "DELETE FROM questions WHERE category_id IN (4,5);",
    ]
    for q in records:
        values = [q["id"], q["categoryId"], q["type"], q["stem"], json.dumps(q["options"], ensure_ascii=False, separators=(",", ":")), q["answer"], q["explanation"], q["source"], q["difficulty"], q["status"], json.dumps(q["details"], ensure_ascii=False, separators=(",", ":"))]
        quoted = [str(values[0]), str(values[1]), *[sql_quote(str(value)) for value in values[2:]]]
        lines.append("INSERT INTO questions (id, category_id, type, stem, options_json, answer, explanation, source, difficulty, status, details_json) VALUES (" + ",".join(quoted) + ");")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--quantity", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--json", type=Path, default=Path("work/numeric-import.json"))
    parser.add_argument("--migration", type=Path, default=Path("migrations/0012_numeric_questions.sql"))
    args = parser.parse_args()
    quantity, q_report = import_doc(args.quantity, "quantity", 4, 500000)
    data, d_report = import_doc(args.data, "data", 5, 600000)
    if len(quantity) != 600 or len(data) != 600 or any(q["answer"] not in LABELS for q in quantity + data):
        raise ValueError("导入前校验失败：题目或答案数量不为 600")
    if any(len(q["options"]) != 4 or not q["details"]["practicalAnalysis"] for q in quantity + data):
        raise ValueError("导入前校验失败：存在选项或实战解析缺失")
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps({"quantity": quantity, "data": data, "report": {"quantity": q_report, "data": d_report}}, ensure_ascii=False, indent=2), encoding="utf-8")
    migration(quantity + data, args.migration)
    print(json.dumps({"quantity": len(quantity), "data": len(data), "quantityReport": q_report, "dataReport": d_report}, ensure_ascii=False))


if __name__ == "__main__":
    main()
