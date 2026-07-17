from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTAMINATION = re.compile(
    r"花生批注|参考答案|题型分类|难度评价|实战解析|练习题\s*\d+\s*套|"
    r"题目整体评价|平均正确率|平均错题数|测试结果"
)
NOTE_MARKER = re.compile(r"([①-⑳])\s*花生批注\s*[：:]")
BRANDING = re.compile(
    r"四\s*海\s*公\s*考|SIHAI\s*GONG\s*KAO|练习题\s*\d+\s*套|"
    r"数量关系\s*600|资料分析\s*600",
    re.I,
)
OPTION_TAIL = re.compile(r"(?m)\n[ \t]*A[ \t]*[.．、]")


def clean_artifacts(value: str) -> str:
    value = value.replace("\u0001", " ").replace("\u0007", " ").replace("\u0015", " ")
    branding = BRANDING.search(value)
    if branding:
        value = value[:branding.start()]
    value = re.sub(r"\n(?:[ \t]*\n){2,}[ \t]*\d{1,3}[ \t]*$", "", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    return value.strip()


def clean_stem(value: str, question_id: int) -> str:
    value = clean_artifacts(value)
    marker = NOTE_MARKER.search(value)
    if marker:
        prefix = value[:marker.start()].strip()
        if prefix:
            value = prefix
    if question_id == 600499:
        value = "2021年商品零售中，1～12月同比增长率与12月同比增长率差值超过10%的类型有几个："
    elif question_id == 500077 and "主人随机安排" in value:
        value = value[value.index("主人随机安排"):]
    elif question_id == 500088 and "某商店在母亲节" in value:
        value = value[value.index("某商店在母亲节"):]
    return clean_artifacts(value)


def clean_option(value: str) -> str:
    return clean_artifacts(value)


def clean_type(value: str, category_id: int) -> str:
    value = re.sub(r"【难度评价】.*$", "", value).strip()
    value = re.sub(r"[①-⑳]", "", value).strip()
    value = re.sub(r"\s+", " ", value)
    if category_id == 5:
        for token, label in (
            ("基期", "基期"), ("增长量", "增长量"), ("增量", "增长量"),
            ("增长率", "增长率"), ("增速", "增长率"), ("比重", "比重"),
        ):
            if token in value:
                return label
        if "平均" in value:
            return "平均数"
        if "查找" in value or "比较" in value or "排序" in value:
            return "查找比较"
        if "简单" in value or "计算" in value:
            return "简单计算"
        if "倍数" in value or "比值" in value:
            return "比值倍数"
        return "综合分析"
    return value or ("数量关系" if category_id == 4 else "综合分析")


def text_is_clean(value: str) -> bool:
    return bool(value.strip()) and CONTAMINATION.search(value) is None


def semantic_score(left: str, right: str) -> float:
    def pairs(value: str) -> set[str]:
        value = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", value)
        return {value[index:index + 2] for index in range(max(0, len(value) - 1))}
    a, b = pairs(left), pairs(right)
    return 2 * len(a & b) / (len(a) + len(b)) if a and b else 0.0


def has_distinctive_overlap(left: str, right: str) -> bool:
    stop = {"亿元", "问题", "答案", "选项", "增长", "数据", "方法", "计算", "可以", "通过", "如下", "进行", "分别", "其中"}
    def grams(value: str, size: int) -> set[str]:
        value = re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", value)
        return {value[index:index + size] for index in range(max(0, len(value) - size + 1))}
    pairs = (grams(left[:180], 2) & grams(right, 2)) - stop
    triples = grams(left[:180], 3) & grams(right, 3)
    return len(pairs) >= 2 or bool(triples)


def merge_quantity_layout(quantity: list[dict], layout: list[dict]) -> None:
    layout_by_id = {question["id"]: question for question in layout}
    for question in quantity:
        alternate = layout_by_id.get(question["id"])
        if not alternate:
            continue
        current_stem = question.get("stem", "")
        alternate_stem = alternate.get("stem", "")
        if text_is_clean(alternate_stem) and (not text_is_clean(current_stem) or len(alternate_stem) < len(current_stem) * 1.35):
            question["stem"] = alternate_stem
            question["details"]["stemRich"] = [{"text": alternate_stem}]
            question["details"]["annotatedStemRich"] = [{"text": alternate_stem}]
        current_options = question.get("options", [])
        alternate_options = alternate.get("options", [])
        current_placeholders = sum("图形选项" in option.get("content", "") for option in current_options)
        alternate_placeholders = sum("图形选项" in option.get("content", "") for option in alternate_options)
        if (
            len(alternate_options) >= 4
            and all(text_is_clean(option.get("content", "")) for option in alternate_options)
            and alternate_placeholders < current_placeholders
        ):
            question["options"] = alternate_options
            question["details"]["annotatedOptionRich"] = {
                option["label"]: [{"text": option["content"]}] for option in alternate_options
            }
            question["details"]["missingOptionLabels"] = alternate["details"].get("missingOptionLabels", [])


def clean_notes(question: dict) -> None:
    details = question.setdefault("details", {})
    base = question.get("stem", "") + " " + details.get("practicalAnalysis", "")
    markers = set(re.findall(r"[①-⑳]", base))
    cleaned = []
    seen = set()
    for note in details.get("notes", []):
        marker = note.get("marker", "")
        raw_note_text = str(note.get("text", ""))
        if int(question["id"]) == 500055 and marker == "⑦":
            continue
        if int(question["id"]) == 600031 and "互联网业务" in raw_note_text:
            continue
        score = float(note.get("matchScore", 0) or 0)
        relevance = semantic_score(raw_note_text, base)
        if not has_distinctive_overlap(raw_note_text, base):
            continue
        if marker not in markers and relevance < 0.04:
            continue
        text = clean_artifacts(raw_note_text)
        option_tail = OPTION_TAIL.search(text)
        if option_tail:
            text = text[:option_tail.start()].strip()
        if not text:
            continue
        key = re.sub(r"\W+", "", marker + text)
        if key in seen:
            continue
        seen.add(key)
        cleaned.append({**note, "text": text, "matchScore": round(max(score, relevance), 3)})
    details["notes"] = cleaned
    practical = clean_artifacts(str(details.get("practicalAnalysis") or question.get("explanation", "")))
    details["practicalAnalysis"] = practical
    question["explanation"] = "\n\n".join(
        [practical, *[f"{note['marker']}花生批注：\n{note['text']}" for note in cleaned]]
    ).strip()


def sanitize_questions(questions: list[dict]) -> None:
    for question in questions:
        original_stem = question.get("stem", "")
        question["stem"] = clean_stem(original_stem, int(question["id"]))
        question["options"] = [
            {**option, "content": clean_option(str(option.get("content", "")))}
            for option in question.get("options", [])
        ]
        if not question["stem"] and question["options"]:
            raw = question["options"][0].get("content", "")
            rich_a = "".join(
                segment.get("text", "")
                for segment in question.get("details", {}).get("annotatedOptionRich", {}).get("A", [])
            )
            source = rich_a or raw
            match = re.search(r"\n\s*A\s*[.．、]\s*", source)
            if match:
                stem = source[:match.start()].strip()
                option_a = source[match.end():].strip()
            else:
                stem, option_a = raw, "20" if int(question["id"]) == 500537 else ""
            if stem.startswith("B"):
                stem = "A、" + stem
            question["stem"] = clean_artifacts(stem)
            question["options"][0]["content"] = clean_artifacts(option_a)
            question.setdefault("details", {})["stemRich"] = [{"text": question["stem"]}]
            question["details"]["annotatedStemRich"] = [{"text": question["stem"]}]
        question["type"] = clean_type(str(question.get("type", "")), int(question["categoryId"]))
        if question["stem"] != original_stem:
            question.setdefault("details", {})["stemRich"] = [{"text": question["stem"]}]
            question["details"]["annotatedStemRich"] = [{"text": question["stem"]}]
        clean_notes(question)


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main():
    quantity = json.loads((ROOT / "work/quantity-xml.json").read_text(encoding="utf-8"))["questions"]
    quantity_layout_path = ROOT / "work/quantity-mainflow-test.json"
    if quantity_layout_path.exists():
        merge_quantity_layout(quantity, json.loads(quantity_layout_path.read_text(encoding="utf-8"))["questions"])
    data_path = ROOT / "work/data-mainflow-test.json"
    if not data_path.exists():
        data_path = ROOT / "work/data-layout.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))["questions"]
    sanitize_questions(quantity)
    sanitize_questions(data)
    logic_images = json.loads((ROOT / "work/logic-graphical.json").read_text(encoding="utf-8"))["questions"]
    if len(quantity) != 600 or len(data) != 600:
        raise ValueError("数量或资料题数不是600")
    existing = json.loads((ROOT / "src/fragmentQuestions.json").read_text(encoding="utf-8"))
    logic_by_id = {q["id"]: q for q in logic_images}
    kept = []
    for question in existing:
        if question.get("categoryId") in {4, 5}:
            continue
        update = logic_by_id.get(question.get("id"))
        if update:
            question["imageKey"] = update["imageKey"]
            question.setdefault("details", {})["imageKeys"] = update["details"]["imageKeys"]
            question["details"]["imageSourcePage"] = update["details"]["imageSourcePage"]
        kept.append(question)
    all_questions = kept + quantity + data
    (ROOT / "src/fragmentQuestions.json").write_text(json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "-- Refresh the complete 600 quantity and 600 data-analysis questions.",
        "INSERT OR IGNORE INTO categories (id,slug,name,short_name,description,color,soft_color,sort_order) VALUES (4,'math','数量关系','数量','数学运算与数字推理','#ef5da8','#fdebf4',4);",
        "INSERT OR IGNORE INTO categories (id,slug,name,short_name,description,color,soft_color,sort_order) VALUES (5,'data','资料分析','资料','基期、增长量、增长率、比重与综合分析','#3b82f6','#eaf2ff',5);",
        "UPDATE categories SET description='基期、增长量、增长率、比重与综合分析' WHERE id=5;",
        "DELETE FROM questions WHERE category_id IN (4,5);",
    ]
    for q in quantity + data:
        columns = ["id", "category_id", "type", "stem", "options_json", "answer", "explanation", "source", "difficulty", "status", "details_json", "image_key"]
        values = [
            str(q["id"]), str(q["categoryId"]), quote(q["type"]), quote(q["stem"]),
            quote(json.dumps(q["options"], ensure_ascii=False, separators=(",", ":"))), quote(q["answer"]),
            quote(q["explanation"]), quote(q["source"]), quote(q["difficulty"]), quote(q["status"]),
            quote(json.dumps(q["details"], ensure_ascii=False, separators=(",", ":"))),
            quote(q["imageKey"]) if q.get("imageKey") else "NULL",
        ]
        lines.append(f"INSERT INTO questions ({','.join(columns)}) VALUES ({','.join(values)});")
    (ROOT / "migrations/0012_numeric_questions.sql").write_text("\n".join(lines) + "\n", encoding="utf-8")

    logic_lines = ["-- Attach source diagrams to the three logic questions that require them."]
    for q in logic_images:
        key = q["imageKey"]
        logic_lines.append(
            f"UPDATE questions SET image_key={quote(key)}, details_json=json_set(COALESCE(details_json,'{{}}'),'$.imageKeys',json_array({quote(key)}),'$.imageSourcePage',{int(q['details']['imageSourcePage'])}) WHERE id={int(q['id'])};"
        )
    (ROOT / "migrations/0014_logic_images.sql").write_text("\n".join(logic_lines) + "\n", encoding="utf-8")
    print(json.dumps({"static": len(all_questions), "quantity": len(quantity), "data": len(data), "logicImages": len(logic_images)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
