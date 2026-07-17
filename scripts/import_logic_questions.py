from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def normalize_type(value: str) -> str:
    value = re.sub(r"[①-㊿0-9⑤⑥⑦⑧⑨⑩]+", "", value)
    value = re.sub(r"\s+", "", value).replace("·", "")
    if value.startswith(("一般质疑", "有论据有结论的一般质疑")):
        return "一般质疑类"
    if value.startswith(("一般支持", "支持")) or value == "分享类":
        return "支持类"
    if value.startswith("分析"):
        return "分析类"
    if value.startswith("归因") or "归因" in value:
        return "归因类"
    if value.startswith(("前提假设", "必要前提")):
        return "前提假设类"
    if value.startswith(("解释", "原因解释")):
        return "解释说明类"
    if value.startswith("推出"):
        return "推出类"
    return value or "逻辑判断"


def analysis_blocks(path: Path) -> dict[int, str]:
    if not path.exists():
        return {}
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    paragraphs = ["".join(t.text or "" for t in p.iter(W + "t")).strip() for p in root.iter(W + "p")]
    title_re = re.compile(r"^\s*(\d{1,2})\s*[.．、]\s*\(")
    merged_re = re.compile(r"逻辑判断.*?(\d{1,2})\s*[.．、]")
    titles = []
    for index, text in enumerate(paragraphs):
        match = title_re.match(text) or merged_re.search(text)
        if not match:
            continue
        number = int(match.group(1))
        if titles and titles[-1][1] == number and index - titles[-1][0] <= 2:
            continue
        titles.append((index, number))
    boundaries = [(0, 0, 0)]
    section = 0
    previous = 0
    for index, number in titles:
        if number <= previous:
            section += 1
        boundaries.append((index, section, number))
        previous = number
    result = {}
    for offset, (start, section, number) in enumerate(boundaries):
        end = boundaries[offset + 1][0] if offset + 1 < len(boundaries) else len(paragraphs)
        text = " ".join(paragraphs[start:end])
        slot = 0 if offset == 0 else section * 20 + number - 1
        result[slot] = text
    return result


def analysis_types(blocks: dict[int, str]) -> dict[int, str]:
    result = {}
    for slot, text in blocks.items():
        match = re.search(r"题型分类\s*[】\]:：]?\s*([^【\n]+)", text)
        if match:
            value = normalize_type(re.split(r"[—–-]", match.group(1).strip(), maxsplit=1)[0].strip())
            if value:
                result[slot] = value
    return result


def practical_explanations(blocks: dict[int, str]) -> dict[int, str]:
    result = {}
    for slot, text in blocks.items():
        match = re.search(r"【?实战解析】?", text)
        if match:
            value = text[match.start():]
        else:
            value = ""
        value = re.sub(r"\s+", " ", value).strip()
        if value and value not in {"【实战解析】", "实战解析"}:
            result[slot] = value
    return result


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def convert(source: Path, static_output: Path, migration_output: Path, explanations: dict[int, str], types: dict[int, str]) -> dict:
    payload = json.loads(source.read_text(encoding="utf-8"))
    logic = []
    sql = [
        "-- Add and refresh the 600 logic-judgement questions.",
        "INSERT OR IGNORE INTO categories (id, slug, name, short_name, description, color, soft_color, sort_order) VALUES (6, 'logic', '逻辑判断', '逻辑', '支持、削弱、真假分析、翻译推理和逻辑论证', '#8b5cf6', '#f0eaff', 6);",
        "DELETE FROM questions WHERE category_id = 6;",
    ]
    for index, item in enumerate(payload["questions"], 1):
        question_id = 400000 + index
        answer_label = "".join(chr(ord("A") + value) for value in item["answer"])
        options = [{"label": chr(ord("A") + n), "content": text} for n, text in enumerate(item["options"])]
        record = {
            "id": question_id, "categoryId": 6, "type": types.get(index - 1, "逻辑判断"), "stem": item["content"],
            "options": options, "answer": answer_label, "explanation": explanations.get(index - 1, ""),
            "source": "逻辑判断600题", "difficulty": "进阶", "status": "published",
            "details": {"globalNumber": index, "sourceNumber": item.get("sourceNumber"), "pairingMode": "question-block"},
        }
        logic.append(record)
        values = [str(question_id), "6", sql_quote(record["type"]), sql_quote(record["stem"]),
                  sql_quote(json.dumps(options, ensure_ascii=False, separators=(",", ":"))), sql_quote(answer_label),
                  sql_quote(record["explanation"]), sql_quote(record["source"]), sql_quote(record["difficulty"]),
                  sql_quote(record["status"]), sql_quote(json.dumps(record["details"], ensure_ascii=False, separators=(",", ":")))]
        sql.append("INSERT INTO questions (id, category_id, type, stem, options_json, answer, explanation, source, difficulty, status, details_json) VALUES (" + ",".join(values) + ");")
    existing = json.loads(static_output.read_text(encoding="utf-8")) if static_output.exists() else []
    existing = [question for question in existing if question.get("categoryId") != 6]
    static_output.write_text(json.dumps(existing + logic, ensure_ascii=False, indent=2), encoding="utf-8")
    migration_output.write_text("\n".join(sql) + "\n", encoding="utf-8")
    return {"logicQuestions": len(logic), "totalStaticQuestions": len(existing) + len(logic), "answers": sum(bool(q["answer"]) for q in logic)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--analysis", type=Path, default=Path(r"C:\Users\Administrator\Desktop\三板块\逻辑判断 600   解析.docx"))
    parser.add_argument("--static", type=Path, default=Path("src/fragmentQuestions.json"))
    parser.add_argument("--migration", type=Path, default=Path("migrations/0008_logic_questions.sql"))
    args = parser.parse_args()
    blocks = analysis_blocks(args.analysis)
    types = analysis_types(blocks)
    explanations = practical_explanations(blocks)
    print(json.dumps({**convert(args.source, args.static, args.migration, explanations, types), "classified": len(types), "explanations": len(explanations)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
