from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import pdfplumber
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps


LOGIC_FIGURE_BOXES = {
    400092: (0.35, 0.36, 0.82, 0.73),
    400098: (0.35, 0.34, 0.82, 0.83),
    400280: (0.30, 0.48, 0.84, 0.67),
}


def normalized(text: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u3400-\u9fff]", "", text)


def trim_white(image: Image.Image, padding: int = 12) -> Image.Image:
    grayscale = image.convert("L")
    bbox = ImageChops.invert(grayscale).getbbox()
    if not bbox:
        return image
    left = max(0, bbox[0] - padding)
    top = max(0, bbox[1] - padding)
    right = min(image.width, bbox[2] + padding)
    bottom = min(image.height, bbox[3] + padding)
    return image.crop((left, top, right, bottom))


def neutralize_annotation_weight(image: Image.Image) -> Image.Image:
    # The analysis Word uses bold weight to mark answers.  Graphical options
    # must remain visible before submission, so normalize every dark stroke to
    # the same weight and prevent the source emphasis from leaking the answer.
    grayscale = ImageOps.autocontrast(image.convert("L"))
    binary = grayscale.point(lambda value: 255 if value > 225 else 0)
    return binary.filter(ImageFilter.MinFilter(3)).convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--json", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--key-prefix", required=True)
    args = parser.parse_args()
    payload = json.loads(args.json.read_text(encoding="utf-8"))
    questions = payload["questions"]
    targets = [q for q in questions if q["details"].get("missingOptionLabels") or q.get("imageKey")]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    misses = []
    with pdfplumber.open(args.pdf) as pdf:
        page_texts = [normalized(page.extract_text(x_tolerance=2, y_tolerance=3, layout=True) or "") for page in pdf.pages]
        for q in targets:
            key = normalized(q["stem"])
            probes = [key[:32], key[:24], key[:16], key[8:28]]
            candidates = [i for i, text in enumerate(page_texts) if any(len(probe) >= 12 and probe in text for probe in probes)]
            if not candidates:
                misses.append(q["id"])
                continue
            expected = q["details"]["globalNumber"] / 600 * len(pdf.pages)
            page_index = min(candidates, key=lambda i: abs(i - expected))
            page = pdf.pages[page_index]
            words = page.extract_words(x_tolerance=2, y_tolerance=3, use_text_flow=True)
            stem_probe = normalized(q["stem"])[:10]
            source_number = q["details"].get("sourceNumber")
            number_re = re.compile(rf"^\s*{source_number}\s*[.．、]") if source_number is not None else None
            starts = [w for w in words if number_re and number_re.search(w["text"])]
            if not starts:
                starts = [w for w in words if len(normalized(w["text"])) >= 4 and (key.startswith(normalized(w["text"])[:10]) or normalized(w["text"])[:8] in key[:36])]
            top = max(0, (starts[0]["top"] if starts else 45) - 4)
            answer_words = [w for w in words if "参考答案" in w["text"] and w["top"] > top + 20]
            segments = []
            if answer_words:
                bottom = answer_words[0]["top"] - 5
                if bottom > top + 40:
                    segments.append(page.crop((0, top, page.width, bottom), strict=False))
                else:
                    segments.append(page.crop((0, top, page.width, page.height - 55), strict=False))
            else:
                segments.append(page.crop((0, top, page.width, page.height - 55), strict=False))
                for continuation_index in range(page_index + 1, min(len(pdf.pages), page_index + 3)):
                    continuation = pdf.pages[continuation_index]
                    continuation_words = continuation.extract_words(x_tolerance=2, y_tolerance=3, use_text_flow=True)
                    continuation_answers = [w for w in continuation_words if "参考答案" in w["text"]]
                    option_labels = [
                        w for w in continuation_words
                        if re.fullmatch(r"[A-H][.．、]?", w["text"].strip())
                    ]
                    continuation_top = max(78, min((w["top"] for w in option_labels), default=158) - 80)
                    bottom = continuation_answers[0]["top"] - 5 if continuation_answers else continuation.height - 55
                    if continuation_top >= bottom:
                        if bottom <= 118:
                            break
                        continuation_top = 78
                    segments.append(continuation.crop((0, continuation_top, continuation.width, bottom), strict=False))
                    if continuation_answers:
                        break
            rendered = [segment.to_image(resolution=150, antialias=True).original.convert("RGB") for segment in segments]
            width = max(image.width for image in rendered)
            height = sum(image.height for image in rendered)
            combined = Image.new("RGB", (width, height), "white")
            offset = 0
            for image in rendered:
                combined.paste(image, (0, offset))
                offset += image.height
            if len(rendered) > 1:
                boundary = rendered[0].height
                ImageDraw.Draw(combined).rectangle((0, boundary, combined.width, min(combined.height, boundary + 40)), fill="white")
            if q["id"] in LOGIC_FIGURE_BOXES:
                left, upper, right, lower = LOGIC_FIGURE_BOXES[q["id"]]
                combined = combined.crop((int(combined.width * left), int(combined.height * upper), int(combined.width * right), int(combined.height * lower)))
            combined = trim_white(neutralize_annotation_weight(combined))
            file = args.output_dir / f"{q['id']}.png"
            combined.save(file, format="PNG", optimize=True)
            key_name = f"{args.key_prefix}/{q['id']}.png"
            q["imageKey"] = key_name
            q["details"]["imageKeys"] = [key_name]
            q["details"]["imageSourcePage"] = page_index + 1
    args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"targets": len(targets), "extracted": len(targets) - len(misses), "misses": misses}, ensure_ascii=False))


if __name__ == "__main__":
    main()
