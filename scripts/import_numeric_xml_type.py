from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from import_complete_numeric_docx import (
    NOTE, compact, concat_rich, extract_notes, marker_numbers, rich_slice,
    rich_text, similarity, xml_paragraphs,
)

TYPE = "【题型分类】"
PRACTICAL_RE = re.compile(r"【\s*实\s*战\s*解\s*析[^】]*】")
ANSWER_RE = re.compile(r"【\s*参考答案(?:及正确率)?\s*】\s*([A-Ha-h])")
OPTION_RE = re.compile(r"(?:^|\n|\s{2,})([A-H])\s*[.．、]")


def question_start(paragraphs, lower: int, answer_at: int, expected: int) -> int:
    numbered = [i for i in range(lower, answer_at) if re.match(rf"^\s*{expected}\s*[.．、]", paragraphs[i].text)]
    if numbered:
        return numbered[-1]
    option_at = next((i for i in range(answer_at - 1, lower - 1, -1) if re.search(r"(?:^|\s)A\s*[.．、]", paragraphs[i].text)), None)
    if option_at is None:
        raise ValueError(f"题号 {expected} 缺失且未找到选项")
    for i in range(option_at - 1, max(lower - 1, option_at - 8), -1):
        value = paragraphs[i].text.strip()
        if value and NOTE not in value and not value.startswith("【"):
            return i
    raise ValueError(f"题号 {expected} 缺失且未找到题干")


def sequential_options(text: str, start: int, end: int):
    found = list(OPTION_RE.finditer(text[start:end]))
    result = []
    expected = "A"
    for match in found:
        if match.group(1) != expected:
            continue
        result.append(match)
        expected = chr(ord(expected) + 1)
    return result if len(result) >= 4 else []


def parse_content(paragraphs, start: int, answer_at: int):
    rich = concat_rich(paragraphs[start:answer_at + 1])
    text = "".join(segment["text"] for segment in rich)
    head = re.match(r"\s*\d{1,2}\s*[.．、]\s*", text)
    begin = head.end() if head else 0
    source = re.match(r"\s*[（(][^）)\n]{0,80}[）)]\s*", text[begin:])
    if source:
        begin += source.end()
    answer = ANSWER_RE.search(text)
    limit = answer.start() if answer else len(text)
    spans = sequential_options(text, begin, limit)
    if not spans:
        stem = compact(text[begin:limit])
        return stem, [{"label": x, "content": "（图形选项，见题目原图）"} for x in "ABCD"], [{"text": stem}], {}, list("ABCD")
    absolute = [(m.group(1), begin + m.start(), begin + m.end()) for m in spans]
    stem_rich = rich_slice(rich, begin, absolute[0][1])
    stem = rich_text(stem_rich)
    options, option_rich, missing = [], {}, []
    for i, (label, _, content_start) in enumerate(absolute):
        content_end = absolute[i + 1][1] if i + 1 < len(absolute) else limit
        value_rich = rich_slice(rich, content_start, content_end)
        value = rich_text(value_rich)
        if NOTE in value:
            value = value.split(NOTE, 1)[0].strip()
        if not value:
            value = "（图形选项，见题目原图）"
            value_rich = [{"text": value}]
            missing.append(label)
        options.append({"label": label, "content": value})
        option_rich[label] = value_rich
    return stem, options, stem_rich, option_rich, missing


def practical_text(paragraphs, type_at: int, end: int):
    start = next((i for i in range(type_at, end) if PRACTICAL_RE.search(paragraphs[i].text)), None)
    labelled = start is not None
    if start is None:
        difficulty = next((i for i in range(type_at, min(end, type_at + 8)) if "【难度评价】" in paragraphs[i].text), None)
        start = difficulty + 1 if difficulty is not None else type_at + 1
    parts = []
    for i in range(start, min(end, start + 70)):
        value = paragraphs[i].text
        if i == start and labelled:
            value = PRACTICAL_RE.split(value, maxsplit=1)[-1]
        elif re.match(r"^\s*\d{1,2}\s*[.．、]", value):
            break
        if NOTE in value:
            before = value.split(NOTE, 1)[0].strip()
            if before:
                parts.append(before)
            break
        if value.strip() and not re.fullmatch(r"(?:四\s*海\s*公\s*考|SIHAI\s*GONG\s*KAO|数量关系\s*600)", value.strip(), re.I):
            parts.append(value)
    return compact("\n".join(parts))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--docx", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    paragraphs = xml_paragraphs(args.docx)
    types = [i for i, p in enumerate(paragraphs) if p.text.lstrip().startswith(TYPE)]
    if len(types) != 600:
        raise ValueError(f"题型锚点 {len(types)}，应为600")
    metadata = []
    for index, type_at in enumerate(types):
        lower = types[index - 1] + 1 if index else 0
        answers = [(i, ANSWER_RE.search(paragraphs[i].text)) for i in range(lower, type_at)]
        answers = [(i, m) for i, m in answers if m]
        if not answers:
            raise ValueError(f"第{index + 1}题答案锚点缺失")
        answer_at, answer_match = answers[-1]
        expected = index % 10 + 1
        start = question_start(paragraphs, lower, answer_at, expected)
        metadata.append((start, answer_at, type_at, answer_match.group(1).upper(), expected))
    records = []
    for index, (start, answer_at, type_at, answer, expected) in enumerate(metadata):
        next_start = metadata[index + 1][0] if index + 1 < len(metadata) else len(paragraphs)
        stem, options, stem_rich, option_rich, missing = parse_content(paragraphs, start, answer_at)
        practical = practical_text(paragraphs, type_at, next_start)
        if not practical:
            raise ValueError(f"第{index + 1}题实战解析缺失：{stem[:60]}")
        raw_type = paragraphs[type_at].text.split(TYPE, 1)[1].strip()
        records.append({
            "id": 500001 + index, "categoryId": 4, "type": raw_type or "数量关系",
            "stem": stem, "options": options, "answer": answer, "explanation": practical,
            "source": "数量关系600题", "difficulty": "进阶", "status": "published",
            "details": {
                "globalNumber": index + 1, "sourceNumber": expected, "typeLabel": raw_type,
                "stemRich": stem_rich, "annotatedStemRich": stem_rich,
                "annotatedOptionRich": option_rich, "practicalAnalysis": practical,
                "notes": [], "missingOptionLabels": missing,
                "pairingMode": "word-type-anchor-and-number",
            }, "_start": start,
        })
    attached = unbound = 0
    for position, marker, content, number in extract_notes(paragraphs):
        group = max((i for i, q in enumerate(records) if q["_start"] <= position), default=0) // 10
        pool = records[group * 10:(group + 1) * 10]
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
        question.pop("_start")
    report = {"count": len(records), "answers": len(records), "withPractical": sum(bool(q["details"]["practicalAnalysis"]) for q in records), "graphicalQuestions": sum(bool(q["details"]["missingOptionLabels"]) for q in records), "notesAttached": attached, "notesUnbound": unbound}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"questions": records, "report": report}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
