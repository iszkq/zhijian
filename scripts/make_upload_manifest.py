from __future__ import annotations

import json
from pathlib import Path


root = Path(__file__).resolve().parents[1]
folders = {4: "quantity", 5: "data", 6: "logic"}
questions = json.loads((root / "src/fragmentQuestions.json").read_text(encoding="utf-8"))
rows = [
    f"{question['id']}\t{folders[question['categoryId']]}\t{question['imageKey']}"
    for question in questions
    if question.get("imageKey") and question.get("categoryId") in folders
]
(root / "work/upload-manifest.tsv").write_text("\n".join(rows) + "\n", encoding="utf-8")
print(len(rows))
