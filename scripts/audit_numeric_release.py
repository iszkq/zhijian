from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


GRAPHIC_PLACEHOLDER = "（图形选项，见题目原图）"
CONTAMINATION = re.compile(
    r"花生批注|参考答案|题型分类|难度评价|实战解析|练习题\d+套|"
    r"题目整体评价|平均正确率|平均错题数|测试结果"
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("path", type=Path, nargs="?", default=Path("src/fragmentQuestions.json"))
    args = parser.parse_args()
    questions = json.loads(args.path.read_text(encoding="utf-8"))

    problems: list[str] = []
    report: dict[str, object] = {}
    for category_id, name, first_id in ((4, "quantity", 500001), (5, "data", 600001), (6, "logic", 400001)):
        items = [question for question in questions if question.get("categoryId") == category_id]
        report[name] = {
            "count": len(items),
            "types": dict(Counter(question.get("type") or "未分类" for question in items)),
            "images": sum(bool(question.get("imageKey")) for question in items),
            "notes": sum(len(question.get("details", {}).get("notes", [])) for question in items),
            "placeholderOptions": sum(
                option.get("content") == GRAPHIC_PLACEHOLDER
                for question in items
                for option in question.get("options", [])
            ),
        }
        if len(items) != 600:
            problems.append(f"{name}: count={len(items)}")
        expected_ids = set(range(first_id, first_id + 600))
        actual_ids = {int(question["id"]) for question in items}
        if actual_ids != expected_ids:
            problems.append(f"{name}: ID set mismatch")
        for question in items:
            qid = question.get("id")
            options = question.get("options", [])
            labels = [option.get("label") for option in options]
            if len(options) < 4 or len(labels) != len(set(labels)):
                problems.append(f"{qid}: invalid options")
            if question.get("answer") not in labels:
                problems.append(f"{qid}: answer {question.get('answer')} not in {labels}")
            if not str(question.get("stem", "")).strip():
                problems.append(f"{qid}: empty stem")
            if not str(question.get("explanation", "")).strip():
                problems.append(f"{qid}: empty explanation")
            details = question.get("details", {})
            if category_id in (4, 5) and not str(details.get("practicalAnalysis", "")).strip():
                problems.append(f"{qid}: empty practicalAnalysis")
            contaminated = CONTAMINATION.search(str(question.get("stem", "")))
            if contaminated:
                problems.append(f"{qid}: stem contamination={contaminated.group(0)}")
            for option in options:
                contaminated = CONTAMINATION.search(str(option.get("content", "")))
                if contaminated:
                    problems.append(f"{qid}: option {option.get('label')} contamination={contaminated.group(0)}")
            missing = details.get("missingOptionLabels", [])
            if missing and not question.get("imageKey"):
                problems.append(f"{qid}: graphical options without imageKey")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    if problems:
        print(json.dumps({"problems": problems}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
    print(json.dumps({"problems": []}, ensure_ascii=False))


if __name__ == "__main__":
    main()
