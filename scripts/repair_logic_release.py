from __future__ import annotations

import argparse
import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from import_logic_questions import analysis_blocks, practical_explanations


ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = re.compile(
    r"题目整体评价|平均正确率|平均错题数|测试结果|时间\s+正确数\s+错误数|"
    r"四海公\S*|SIHAI\s*GONG\s*KAO|练习题\s*\d+\s*套?",
    re.I,
)


def normalized(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", value)


def semantic_score(left: str, right: str) -> float:
    def pairs(value: str) -> set[str]:
        value = normalized(value)
        return {value[index:index + 2] for index in range(max(0, len(value) - 1))}
    a, b = pairs(left), pairs(right)
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


def has_distinctive_overlap(left: str, right: str) -> bool:
    stop = {"问题", "答案", "选项", "命题", "可以", "通过", "如果", "因为", "所以", "说明", "认为"}
    def grams(value: str, size: int) -> set[str]:
        value = normalized(value)
        return {value[index:index + size] for index in range(max(0, len(value) - size + 1))}
    pairs = (grams(left[:180], 2) & grams(right, 2)) - stop
    triples = grams(left[:180], 3) & grams(right, 3)
    return len(pairs) >= 2 or bool(triples)


def clean(value: str) -> str:
    match = ARTIFACT.search(value)
    if match:
        value = value[:match.start()]
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return value.strip()


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def recover_explanation(question: dict, candidates: list[tuple[str, str]]) -> str:
    key = normalized(question["stem"])
    direct = [(text, explanation) for text, explanation in candidates if key[:20] and key[:20] in normalized(text)]
    if direct:
        return max(direct, key=lambda item: len(normalized(item[0])[: len(key)]))[1]
    ranked = max(
        candidates,
        key=lambda item: SequenceMatcher(None, key[:180], normalized(item[0])[:500], autojunk=False).ratio(),
    )
    return ranked[1]


def repair(static_path: Path, analysis_path: Path, migration_path: Path) -> dict:
    payload = json.loads(static_path.read_text(encoding="utf-8"))
    blocks = analysis_blocks(analysis_path)
    candidates = []
    for text in blocks.values():
        explanation = practical_explanations({0: text}).get(0, "")
        if explanation:
            candidates.append((text, explanation))

    recovered = 0
    note_count = 0
    logic = [question for question in payload if question.get("categoryId") == 6]
    for question in logic:
        question["stem"] = clean(question.get("stem", ""))
        question["options"] = [
            {**option, "content": clean(str(option.get("content", "")))}
            for option in question.get("options", [])
        ]
        if not str(question.get("explanation", "")).strip():
            question["explanation"] = recover_explanation(question, candidates)
            recovered += 1
        question["explanation"] = clean(question["explanation"])
        details = question.setdefault("details", {})
        details["practicalAnalysis"] = question["explanation"]
        markers = set(re.findall(r"[①-⑳]", question["stem"] + " " + question["explanation"]))
        cleaned_notes = []
        seen = set()
        for note in details.get("notes", []):
            marker = str(note.get("marker", ""))
            content = clean(str(note.get("text") or note.get("content") or ""))
            score = float(note.get("matchScore", 0) or 0)
            circled = next(iter(re.findall(r"[①-⑳]", marker)), "")
            relevance = semantic_score(content, question["stem"] + " " + question["explanation"])
            if not content or not has_distinctive_overlap(content, question["stem"] + " " + question["explanation"]):
                continue
            if circled not in markers and relevance < 0.04:
                continue
            key = normalized(marker + content)
            if key in seen:
                continue
            seen.add(key)
            cleaned_notes.append({"marker": circled or marker.replace("花生批注", "").strip(" ：:"), "text": content, "matchScore": round(max(score, relevance), 4)})
        if int(question["id"]) == 400280 and not cleaned_notes:
            cleaned_notes.append({
                "marker": "③",
                "text": "命题A→B的真假判断：只在A且非B时为假；前件为假或后件为真时，命题为真。第二种思路：第二张、第三张已经不能满足“五角星且非3”，无需翻转；第一张、第四张仍可能满足，需要翻转验证。",
                "matchScore": 1.0,
            })
        details["notes"] = cleaned_notes
        note_count += len(cleaned_notes)

    static_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["-- Refresh all 600 logic questions while preserving their stable IDs."]
    for question in logic:
        columns = ["id", "category_id", "type", "stem", "options_json", "answer", "explanation", "source", "difficulty", "status", "details_json", "image_key"]
        values = [
            str(question["id"]), str(question["categoryId"]), quote(question["type"]), quote(question["stem"]),
            quote(json.dumps(question["options"], ensure_ascii=False, separators=(",", ":"))), quote(question["answer"]),
            quote(question["explanation"]), quote(question["source"]), quote(question["difficulty"]), quote(question["status"]),
            quote(json.dumps(question["details"], ensure_ascii=False, separators=(",", ":"))),
            quote(question["imageKey"]) if question.get("imageKey") else "NULL",
        ]
        lines.append(
            f"INSERT INTO questions ({','.join(columns)}) VALUES ({','.join(values)}) "
            f"ON CONFLICT(id) DO UPDATE SET category_id=excluded.category_id,type=excluded.type,stem=excluded.stem,"
            f"options_json=excluded.options_json,answer=excluded.answer,explanation=excluded.explanation,source=excluded.source,"
            f"difficulty=excluded.difficulty,status=excluded.status,details_json=excluded.details_json,image_key=excluded.image_key;"
        )
    migration_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"logic": len(logic), "recoveredExplanations": recovered, "notes": note_count}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--static", type=Path, default=ROOT / "src/fragmentQuestions.json")
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--migration", type=Path, default=ROOT / "migrations/0013_restore_logic_static.sql")
    args = parser.parse_args()
    print(json.dumps(repair(args.static, args.analysis, args.migration), ensure_ascii=False))


if __name__ == "__main__":
    main()
