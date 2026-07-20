from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
PRACTICAL = "【实战解析】"
ARTIFACT = re.compile(
    r"出自\s*20\d{2}年|公考最新资料[^\n]*|四\s*SIHA\S*|SIHAI\S{0,20}|【全篇答案】|"
    r"资料分析\s*6\s*0\s*0|数量关系\s*6\s*0\s*0|题目整体评价|练习题\s*\d+\s*套",
    re.I,
)


def normalized(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", value)


def clean(value: str) -> str:
    artifact = ARTIFACT.search(value)
    if artifact:
        value = value[:artifact.start()]
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return value.strip()


def paragraphs(path: Path) -> list[str]:
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    return ["".join(node.text or "" for node in paragraph.iter(W + "t")).strip() for paragraph in root.iter(W + "p")]


def recover(question: dict, values: list[str], norms: list[str]) -> str:
    key = normalized(question["stem"])
    probes = [key[:32], key[:24], key[:18]]
    starts = [
        index for index, value in enumerate(norms)
        if any(len(probe) >= 12 and probe in value for probe in probes)
    ]
    best = ""
    for question_at in starts:
        practical_at = next(
            (index for index in range(question_at, min(len(values), question_at + 120)) if PRACTICAL in values[index]),
            None,
        )
        if practical_at is None:
            continue
        parts = []
        for index in range(practical_at, min(len(values), practical_at + 30)):
            value = values[index]
            if index == practical_at:
                value = value.split(PRACTICAL, 1)[1]
            elif (
                re.match(r"^\s*\d{1,2}\s*[.．、]\s*", value)
                or "【参考答案" in value
                or "【题型分类】" in value
                or "花生批注" in value
            ):
                break
            artifact = ARTIFACT.search(value)
            if artifact:
                value = value[:artifact.start()]
                value = clean(value)
                if value:
                    parts.append(value)
                break
            value = clean(value)
            if value:
                parts.append(value)
        candidate = clean("\n".join(parts))
        if len(candidate) > len(best):
            best = candidate
    return best


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def write_migration(path: Path, questions: list[dict]) -> None:
    lines = [
        "-- Refresh the complete 600 quantity and 600 data-analysis questions.",
        "INSERT OR IGNORE INTO categories (id,slug,name,short_name,description,color,soft_color,sort_order) VALUES (4,'math','数量关系','数量','数学运算与数字推理','#ef5da8','#fdebf4',4);",
        "INSERT OR IGNORE INTO categories (id,slug,name,short_name,description,color,soft_color,sort_order) VALUES (5,'data','资料分析','资料','基期、增长量、增长率、比重与综合分析','#3b82f6','#eaf2ff',5);",
        "UPDATE categories SET description='基期、增长量、增长率、比重与综合分析' WHERE id=5;",
        "DELETE FROM questions WHERE category_id IN (4,5);",
    ]
    for question in questions:
        columns = ["id", "category_id", "type", "stem", "options_json", "answer", "explanation", "source", "difficulty", "status", "details_json", "image_key"]
        values = [
            str(question["id"]), str(question["categoryId"]), quote(question["type"]), quote(question["stem"]),
            quote(json.dumps(question["options"], ensure_ascii=False, separators=(",", ":"))), quote(question["answer"]),
            quote(question["explanation"]), quote(question["source"]), quote(question["difficulty"]), quote(question["status"]),
            quote(json.dumps(question["details"], ensure_ascii=False, separators=(",", ":"))),
            quote(question["imageKey"]) if question.get("imageKey") else "NULL",
        ]
        lines.append(f"INSERT INTO questions ({','.join(columns)}) VALUES ({','.join(values)});")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--static", type=Path, default=Path("src/fragmentQuestions.json"))
    parser.add_argument("--quantity", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--migration", type=Path, default=Path("migrations/0012_numeric_questions.sql"))
    args = parser.parse_args()

    payload = json.loads(args.static.read_text(encoding="utf-8"))
    sources = {}
    for category_id, path in ((4, args.quantity), (5, args.data)):
        values = paragraphs(path)
        sources[category_id] = (values, [normalized(value) for value in values])

    recovered = cleaned_notes = 0
    numeric = [question for question in payload if question.get("categoryId") in (4, 5)]
    for question in numeric:
        details = question.setdefault("details", {})
        practical = clean(str(details.get("practicalAnalysis") or question.get("explanation", "")))
        has_artifact = bool(ARTIFACT.search(str(details.get("practicalAnalysis", ""))))
        if len(practical) < 80 or has_artifact:
            candidate = recover(question, *sources[int(question["categoryId"])])
            if len(candidate) > len(practical) + 10:
                practical = candidate
                recovered += 1
        details["practicalAnalysis"] = practical
        notes = []
        for note in details.get("notes", []):
            text = clean(str(note.get("text", "")))
            if not text or len(text) > 600 or ARTIFACT.search(str(note.get("text", ""))):
                cleaned_notes += 1
                continue
            notes.append({**note, "text": text})
        details["notes"] = notes
        question["explanation"] = "\n\n".join(
            [practical, *[f"{note['marker']}花生批注：\n{note['text']}" for note in notes]]
        ).strip()

    args.static.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    write_migration(args.migration, numeric)
    print(json.dumps({"questions": len(numeric), "recoveredPractical": recovered, "removedNotes": cleaned_notes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
