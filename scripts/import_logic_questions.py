from __future__ import annotations

import argparse
import json
from pathlib import Path


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def convert(source: Path, static_output: Path, migration_output: Path) -> dict:
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
            "id": question_id, "categoryId": 6, "type": "逻辑判断", "stem": item["content"],
            "options": options, "answer": answer_label, "explanation": item.get("explanation", ""),
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
    static_output.write_text(json.dumps(existing + logic, ensure_ascii=False, indent=2), encoding="utf-8")
    migration_output.write_text("\n".join(sql) + "\n", encoding="utf-8")
    return {"logicQuestions": len(logic), "totalStaticQuestions": len(existing) + len(logic), "answers": sum(bool(q["answer"]) for q in logic)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--static", type=Path, default=Path("src/fragmentQuestions.json"))
    parser.add_argument("--migration", type=Path, default=Path("migrations/0008_logic_questions.sql"))
    args = parser.parse_args()
    print(json.dumps(convert(args.source, args.static, args.migration), ensure_ascii=False))


if __name__ == "__main__":
    main()
