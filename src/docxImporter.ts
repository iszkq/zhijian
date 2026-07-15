import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { Option, RichTextSegment } from "./types";

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const QUESTION_START = /^\s*(\d{1,2})\s*[.．]\s*([\s\S]*)$/;
const ANALYSIS_START = /^\s*(\d{1,2})\s*[.．]\s*([（(][\s\S]*)$/;
const OPTION_LABEL = /(?:^|\n)\s*([A-D])(?:\s*[.．、]|\s+)|(?<![A-Za-z])([A-D])\s*[.．、]/gm;
const ANSWER_LABEL = "【参考答案】";
const PRACTICAL_LABEL = "【实战解析】";
const NOTE_LABEL = "花生批注";
const TYPE_LABEL = /【题型[^】]*】\s*([^\n]+)/;
const LABELS = ["A", "B", "C", "D"];

const KNOWN_OPTION_REPAIRS: Record<string, Record<string, string>> = {
  "4-19": { A: "⑤③①②④⑥", B: "⑤①③⑥④②", C: "①③④⑥②⑤", D: "①③②④⑥⑤" },
  "9-20": { A: "⑥④①③⑤②", B: "⑤④①③⑥②", C: "⑤⑥②①④③", D: "⑥②⑤④①③" },
  "14-18": { A: "⑥⑦①⑤②③④", B: "④⑦①②⑤③⑥", C: "⑥⑦③①④⑤②", D: "④⑦③①⑤②⑥" }
};

const circled = [
  ...Array.from({ length: 20 }, (_, index) => String.fromCodePoint(0x2460 + index)),
  ...Array.from({ length: 15 }, (_, index) => String.fromCodePoint(0x3251 + index)),
  ...Array.from({ length: 15 }, (_, index) => String.fromCodePoint(0x32b1 + index))
];
const circledValues = new Map(circled.map((char, index) => [char, index + 1]));
const markerChars = new Set([...circled, ..."0123456789"]);

type StyledChar = RichTextSegment & { text: string };
type Paragraph = { element: Element; text: string; chars: StyledChar[] };
type ParsedDocument = { document: Document; all: Paragraph[]; leaf: Paragraph[]; direct: Paragraph[]; textboxes: Paragraph[][]; cells: Paragraph[][] };

type WorkingQuestion = {
  setNumber: number;
  localNumber: number;
  stem: string;
  stemRich: RichTextSegment[];
  options: Option[];
  optionRich: Record<string, RichTextSegment[]>;
  source?: string;
  sourceLabel?: string;
  accuracy?: number | null;
  answer?: string | null;
  typeAndPassage?: string | null;
  practicalAnalysis?: string;
  annotatedStem?: string;
  annotatedStemRich?: RichTextSegment[];
  annotatedOptions?: Option[];
  annotatedOptionRich?: Record<string, RichTextSegment[]>;
  notes?: ParsedNote[];
  matchScore?: number;
  pairingMode?: string;
  inlineMarkers?: number[];
};

type AnalysisCandidate = {
  localNumber: number;
  source: string;
  sourceLabel: string;
  accuracy: number | null;
  answer: string | null;
  typeAndPassage: string | null;
  practicalAnalysis: string;
  annotatedStem: string;
  annotatedStemRich: RichTextSegment[];
  annotatedOptions: Option[];
  annotatedOptionRich: Record<string, RichTextSegment[]>;
};

type ParsedNote = { marker: string; number: number | null; content: string; matchScore?: number; order?: number };

export type ImportedQuestion = {
  importKey: string;
  type: string;
  stem: string;
  options: Option[];
  answer: string;
  explanation: string;
  source: string;
  difficulty: "基础" | "进阶" | "挑战";
  status: "published" | "draft";
  details: Record<string, unknown>;
};

export type ImportPreview = {
  questions: ImportedQuestion[];
  warnings: string[];
  pairs: Array<{ book: string; analysis: string; count: number }>;
  summary: {
    total: number;
    paired: number;
    withPractical: number;
    withNotes: number;
    withUnderline: number;
    sequenceFallbacks: number;
  };
};

const noisePatterns = [
  /^\s*$/,
  /^练习题\s*\d+\s*套\s*$/,
  /^练习题\s*\d+\s*$/,
  /^片段阅读\s*6?0?0?\s*[（(]?[上下]册[）)]?\s*$/,
  /^四海公考\s*$/,
  /^SIHAI\s*GONG\s*KAO\s*$/i,
  /^\d{1,3}\s*$/
];

function normalizeSpace(text: string) {
  return text.replaceAll("\u3000", " ").replaceAll("\u00a0", " ").replaceAll("\t", " ")
    .replace(/[ \r\f\v]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function compactText(text: string) {
  return normalizeSpace(text)
    .replace(/(?<=[\u3400-\u9fff，。；：！？、（）《》“”‘’]) +(?=[\u3400-\u9fff，。；：！？、（）《》“”‘’])/g, "")
    .replace(/(?<=[\u3400-\u9fff]) +(?=[A-D](?:选项|项))/g, "")
    .replace(/(?<=[A-D]) +(?=(?:选项|项))/g, "")
    .trim();
}

function canonicalLabels(text: string) {
  return text.replace(/【\s*参考答案\s*】/g, ANSWER_LABEL)
    .replace(/【\s*实战解析\s*】/g, PRACTICAL_LABEL)
    .replace(/【\s*(题型[^】]*?)\s*】/g, (_, label: string) => `【${compactText(label)}】`);
}

function matchText(text: string) {
  return compactText(text).replace(/[^0-9A-Za-z\u3400-\u9fff]/g, "").toLowerCase();
}

function isNoise(text: string) {
  const value = normalizeSpace(text);
  return noisePatterns.some((pattern) => pattern.test(value));
}

function nearest(node: Node | null, localName: string): Element | null {
  let current = node?.parentNode ?? null;
  while (current && current.nodeType === 1) {
    const element = current as Element;
    if (element.namespaceURI === WORD_NS && element.localName === localName) return element;
    current = current.parentNode;
  }
  return null;
}

function wordElements(node: Document | Element, localName: string) {
  return Array.from(node.getElementsByTagNameNS(WORD_NS, localName)) as Element[];
}

function truthyProperty(run: Element, localName: string, noneValue?: string) {
  const property = wordElements(run, localName).find((element) => nearest(element, "r") === run);
  if (!property) return false;
  const value = property.getAttributeNS(WORD_NS, "val") ?? property.getAttribute("w:val") ?? "true";
  return !["0", "false", "off", noneValue].filter(Boolean).includes(value.toLowerCase());
}

function runText(run: Element) {
  const parts: string[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.namespaceURI === WORD_NS) {
        if (element.localName === "t") { parts.push(element.textContent ?? ""); continue; }
        if (element.localName === "tab") { parts.push("\t"); continue; }
        if (element.localName === "br" || element.localName === "cr") { parts.push("\n"); continue; }
      }
      walk(element);
    }
  };
  walk(run);
  return parts.join("");
}

function parseParagraph(element: Element): Paragraph {
  const chars: StyledChar[] = [];
  const styleCache = new Map<Element, Omit<StyledChar, "text">>();
  const styleFor = (node: Element) => {
    const run = nearest(node, "r");
    if (!run || nearest(run, "p") !== element) return {};
    const cached = styleCache.get(run);
    if (cached) return cached;
    const style = {
      ...(truthyProperty(run, "b") ? { bold: true } : {}),
      ...(truthyProperty(run, "u", "none") ? { underline: true } : {}),
      ...(truthyProperty(run, "i") ? { italic: true } : {})
    };
    styleCache.set(run, style);
    return style;
  };
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType !== 1) continue;
      const value = child as Element;
      if (value !== element && value.namespaceURI === WORD_NS && value.localName === "p") continue;
      if (value.namespaceURI === WORD_NS && value.localName === "t") {
        const style = styleFor(value);
        for (const text of value.textContent ?? "") chars.push({ text, ...style });
        continue;
      }
      if (value.namespaceURI === WORD_NS && value.localName === "tab") { chars.push({ text: "\t", ...styleFor(value) }); continue; }
      if (value.namespaceURI === WORD_NS && (value.localName === "br" || value.localName === "cr")) { chars.push({ text: "\n", ...styleFor(value) }); continue; }
      walk(value);
    }
  };
  walk(element);
  return { element, chars, text: chars.map((item) => item.text).join("") };
}

async function readDocument(file: File): Promise<ParsedDocument> {
  if (!file.name.toLowerCase().endsWith(".docx")) throw new Error(`${file.name} 不是 DOCX 文件`);
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentXml = archive["word/document.xml"];
  if (!documentXml) throw new Error(`${file.name} 缺少 word/document.xml，可能不是有效的 Word 文档`);
  const document = new XmlDomParser().parseFromString(strFromU8(documentXml), "application/xml") as unknown as Document;
  const parseError = document.getElementsByTagName("parsererror")[0];
  if (parseError) throw new Error(`${file.name} 的 Word XML 无法解析`);
  const body = wordElements(document, "body")[0];
  if (!body) throw new Error(`${file.name} 缺少正文`);
  const all = wordElements(body, "p").map(parseParagraph);
  const byElement = new Map(all.map((paragraph) => [paragraph.element, paragraph]));
  const leaf = all.filter((paragraph) => !wordElements(paragraph.element, "p").length);
  const direct = all.filter((paragraph) => paragraph.element.parentNode === body);
  const textboxes = wordElements(body, "txbxContent").map((box) => wordElements(box, "p").map((p) => byElement.get(p) ?? parseParagraph(p)));
  const cells = wordElements(body, "tc").map((cell) => wordElements(cell, "p").filter((p) => nearest(p, "tc") === cell).map((p) => byElement.get(p) ?? parseParagraph(p)));
  return { document, all, leaf, direct, textboxes, cells };
}

function streamChars(paragraphs: Paragraph[]) {
  const result: StyledChar[] = [];
  let kept = 0;
  for (const paragraph of paragraphs) {
    if (isNoise(paragraph.text)) continue;
    let values = paragraph.chars.flatMap((item) => Array.from(item.text).map((text) => ({ ...item, text })));
    const paragraphText = values.map((item) => item.text).join("");
    const cuts = ["公考最新资料", "更新进度微信"].map((marker) => paragraphText.indexOf(marker)).filter((position) => position >= 0);
    if (cuts.length) values = values.slice(0, Math.min(...cuts));
    if (!values.length) continue;
    if (kept) result.push({ text: "\n" });
    result.push(...values);
    kept += 1;
  }
  return result;
}

function normalizeStyledChars(chars: StyledChar[]) {
  const normalized: StyledChar[] = [];
  for (const item of chars) {
    let char = item.text.replaceAll("\u3000", " ").replaceAll("\t", " ").replaceAll("\r", "\n");
    if (/\s/.test(char) && char !== "\n") char = item.underline ? "\u00a0" : " ";
    if (char === " " && normalized.length && [" ", "\n"].includes(normalized.at(-1)!.text)) continue;
    if (char === "\n" && normalized.at(-1)?.text === "\n") continue;
    normalized.push({ ...item, text: char });
  }
  const cjk = (value: string) => /^[\u3400-\u9fff，。；：！？、（）《》“”‘’]$/.test(value);
  const cleaned = normalized.filter((item, index) => !(item.text === " " && !item.underline && cjk(normalized[index - 1]?.text ?? "") && cjk(normalized[index + 1]?.text ?? "")));
  while (cleaned.length && [" ", "\n"].includes(cleaned[0].text)) cleaned.shift();
  while (cleaned.length && [" ", "\n"].includes(cleaned.at(-1)!.text)) cleaned.pop();
  return cleaned;
}

function compressRuns(chars: StyledChar[]): RichTextSegment[] {
  const runs: RichTextSegment[] = [];
  for (const item of normalizeStyledChars(chars)) {
    const previous = runs.at(-1);
    if (previous && Boolean(previous.bold) === Boolean(item.bold) && Boolean(previous.underline) === Boolean(item.underline) && Boolean(previous.italic) === Boolean(item.italic)) {
      previous.text += item.text;
    } else {
      runs.push({ text: item.text, ...(item.bold ? { bold: true } : {}), ...(item.underline ? { underline: true } : {}), ...(item.italic ? { italic: true } : {}) });
    }
  }
  return runs;
}

function runsText(runs: RichTextSegment[]) {
  return compactText(runs.map((run) => run.text.replaceAll("\u00a0", " ")).join(""));
}

function findOptionSpans(text: string, requireFour = true) {
  const matches = Array.from(text.matchAll(new RegExp(OPTION_LABEL.source, OPTION_LABEL.flags)));
  const label = (match: RegExpMatchArray) => match[1] || match[2];
  for (let start = 0; start < matches.length; start += 1) {
    if (label(matches[start]) !== "A") continue;
    const selected = [matches[start]];
    let expected = "B";
    for (const candidate of matches.slice(start + 1)) {
      if (label(candidate) !== expected) continue;
      selected.push(candidate);
      if (expected === "D") return selected.map((item) => ({ label: label(item), start: item.index!, end: item.index! + item[0].length }));
      expected = String.fromCharCode(expected.charCodeAt(0) + 1);
    }
  }
  if (!requireFour) {
    const seen = new Set<string>();
    return matches.filter((match) => !seen.has(label(match)) && Boolean(seen.add(label(match)))).map((item) => ({ label: label(item), start: item.index!, end: item.index! + item[0].length }));
  }
  return [];
}

function parseQuestionContent(paragraphs: Paragraph[], analysisHeader = false, allowPartialOptions = false) {
  const chars = streamChars(paragraphs);
  const text = chars.map((item) => item.text).join("");
  const header = (analysisHeader ? ANALYSIS_START : QUESTION_START).exec(text);
  if (!header) throw new Error(`编号题目解析失败：${text.slice(0, 80)}`);
  let contentStart = header[0].indexOf(header[1]) + header[1].length;
  while (contentStart < text.length && " .．\n".includes(text[contentStart])) contentStart += 1;
  if (analysisHeader) {
    const newline = text.indexOf("\n", contentStart);
    if (newline >= 0) contentStart = newline + 1;
  }
  let spans = findOptionSpans(text.slice(contentStart), !allowPartialOptions);
  if (spans.length < (allowPartialOptions ? 1 : 4)) throw new Error(`未找到完整选项：${text.slice(0, 100)}`);
  spans = spans.map((span) => ({ ...span, start: span.start + contentStart, end: span.end + contentStart }));
  const stemRich = compressRuns(chars.slice(contentStart, spans[0].start));
  const options: Option[] = [];
  const optionRich: Record<string, RichTextSegment[]> = {};
  spans.forEach((span, index) => {
    const end = spans[index + 1]?.start ?? chars.length;
    let optionChars = chars.slice(span.end, end);
    const raw = optionChars.map((item) => item.text).join("");
    const cutoff = [raw.indexOf(ANSWER_LABEL), raw.indexOf("【题型"), raw.indexOf(PRACTICAL_LABEL)].filter((value) => value >= 0);
    if (cutoff.length) optionChars = optionChars.slice(0, Math.min(...cutoff));
    const rich = compressRuns(optionChars);
    options.push({ label: span.label, content: runsText(rich) });
    optionRich[span.label] = rich;
  });
  return { stemRich, stem: runsText(stemRich), options, optionRich };
}

function splitNumberedChunks(paragraphs: Paragraph[], analysis: boolean) {
  const pattern = analysis ? ANALYSIS_START : QUESTION_START;
  const starts: number[] = [];
  paragraphs.forEach((paragraph, index) => {
    const match = pattern.exec(normalizeSpace(paragraph.text));
    if (match && Number(match[1]) >= 1 && Number(match[1]) <= 20) starts.push(index);
  });
  return starts.map((start, index) => paragraphs.slice(start, starts[index + 1] ?? paragraphs.length));
}

function parseBook(document: ParsedDocument, firstSet: number, filename: string) {
  const chunks = splitNumberedChunks(document.all, false);
  if (!chunks.length || chunks.length % 20 !== 0) throw new Error(`${filename}：识别到 ${chunks.length} 道题，题数应为 20 的倍数`);
  return chunks.map((chunk, index): WorkingQuestion => {
    const expected = index % 20 + 1;
    const actual = Number(QUESTION_START.exec(normalizeSpace(chunk[0].text))?.[1]);
    if (actual !== expected) throw new Error(`${filename}：第 ${index + 1} 道题序号为 ${actual}，预期为 ${expected}`);
    const parsed = parseQuestionContent(chunk, false, true);
    return { setNumber: firstSet + Math.floor(index / 20), localNumber: expected, ...parsed };
  });
}

function paragraphPlainStream(paragraphs: Paragraph[]) {
  return paragraphs.filter((paragraph) => paragraph.text && !isNoise(paragraph.text)).map((paragraph) => canonicalLabels(compactText(paragraph.text))).join("\n");
}

function extractSource(header: string) {
  const value = (ANALYSIS_START.exec(normalizeSpace(header))?.[2] ?? header).replace(/^[（）() ]+|[（）() ]+$/g, "");
  const accuracyMatch = /(\d{1,3})\s*%/.exec(value);
  const accuracy = accuracyMatch ? Number(accuracyMatch[1]) : null;
  const source = value.replace(/\s*\d{1,3}\s*%\s*$/, "").trim() || "片段阅读";
  return { source, accuracy, sourceLabel: value };
}

function parseAnalysisCandidate(chunk: Paragraph[]): AnalysisCandidate | null {
  if (!chunk.length) return null;
  const header = normalizeSpace(chunk[0].text);
  const start = ANALYSIS_START.exec(header);
  if (!start) return null;
  const fullText = paragraphPlainStream(chunk);
  const answer = /【参考答案\s*】\s*([A-Da-d])/.exec(fullText)?.[1]?.toUpperCase() ?? null;
  const typeAndPassage = TYPE_LABEL.exec(fullText)?.[1] ? compactText(TYPE_LABEL.exec(fullText)![1]) : null;
  const practical: string[] = [];
  let practicalStarted = false;
  for (const paragraph of chunk) {
    let text = canonicalLabels(compactText(paragraph.text));
    if (!text || isNoise(text)) continue;
    if (text.includes(PRACTICAL_LABEL)) { practicalStarted = true; text = text.split(PRACTICAL_LABEL, 2)[1].trim(); }
    if (!practicalStarted) continue;
    if (text.includes(NOTE_LABEL)) {
      const before = text.split(NOTE_LABEL, 1)[0].replace(/[①-⑳㉑-㊿0-9]+$/, "").replace(/^[：: ]+|[：: ]+$/g, "");
      if (before) practical.push(before);
      break;
    }
    if (ANALYSIS_START.test(text) || text.includes(ANSWER_LABEL) || TYPE_LABEL.test(text)) continue;
    practical.push(text);
  }
  let annotated;
  try { annotated = parseQuestionContent(chunk, true, true); } catch { return null; }
  return {
    localNumber: Number(start[1]),
    ...extractSource(header),
    answer,
    typeAndPassage,
    practicalAnalysis: practical.join("\n").trim(),
    annotatedStem: annotated.stem,
    annotatedStemRich: annotated.stemRich,
    annotatedOptions: annotated.options,
    annotatedOptionRich: annotated.optionRich
  };
}

function diceSimilarity(left: string, right: string) {
  const a = matchText(left).slice(0, 800);
  const b = matchText(right).slice(0, 800);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const counts = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) counts.set(a.slice(index, index + 2), (counts.get(a.slice(index, index + 2)) ?? 0) + 1);
  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = counts.get(pair) ?? 0;
    if (count) { overlap += 1; counts.set(pair, count - 1); }
  }
  return (2 * overlap) / Math.max(1, a.length + b.length - 2);
}

function inferType(stem: string) {
  if (stem.includes("重新排列")) return "语句排序类";
  if (stem.includes("填入文中画横线") || stem.includes("填入横线")) return "语句填入类";
  if (stem.includes("接下来")) return "下文推断类";
  if (["说法正确", "说法错误", "相符的是", "不相符的是"].some((value) => stem.includes(value))) return "细节判断类";
  return "中心理解题";
}

function cleanOption(content: string, sequenceLimit?: number) {
  const value = content.trim();
  // Sorting answers are made entirely of circled numerals. Do not treat the
  // numerals themselves as a trailing annotation marker (which used to turn
  // every sorting option into an empty string).
  if (/^[①-⑳㉑-㊿\s]+$/.test(value)) {
    const sequence = Array.from(value).filter((char) => circledValues.has(char));
    return (sequenceLimit ? sequence.slice(0, sequenceLimit) : sequence).join("");
  }
  return value.replace(/[①-⑳㉑-㊿]+$/, "").trim()
    .replace(/\s*[（(](?:片面|无中生有|具体类|出处有误|表述有误|强加因果|区别比较联系类|中性表达)[^）)]*[）)]\s*$/, "");
}

function sortingSequenceLimit(stem: string) {
  const explicit = /(?:以上|下列)\s*(\d+)\s*个/.exec(stem)?.[1];
  if (explicit) return Number(explicit);
  const values = Array.from(stem).flatMap((char) => circledValues.has(char) ? [circledValues.get(char)!] : []);
  return values.length ? Math.max(...values) : undefined;
}

function mergeAnalysis(document: ParsedDocument, bases: WorkingQuestion[], filename: string) {
  const primaryChunks = splitNumberedChunks(document.all, true);
  if (primaryChunks.length !== bases.length) throw new Error(`${filename}：解析题数 ${primaryChunks.length} 与题本 ${bases.length} 不一致`);
  const primary = primaryChunks.map(parseAnalysisCandidate);
  const missing = primary.flatMap((candidate, index) => candidate ? [] : [index + 1]);
  if (missing.length) throw new Error(`${filename}：第 ${missing.slice(0, 10).join("、")} 题解析识别失败`);
  const streams = [document.all, document.direct, document.leaf, ...document.textboxes, ...document.cells];
  const candidates = [...primary.filter(Boolean) as AnalysisCandidate[]];
  for (const stream of streams) for (const chunk of splitNumberedChunks(stream, true)) {
    const candidate = parseAnalysisCandidate(chunk);
    if (candidate) candidates.push(candidate);
  }
  const bySource = new Map<string, AnalysisCandidate[]>();
  for (const candidate of candidates) bySource.set(candidate.sourceLabel, [...(bySource.get(candidate.sourceLabel) ?? []), candidate]);
  bases.forEach((base, index) => {
    const ordered = primary[index]!;
    const expected = index % 20 + 1;
    if (ordered.localNumber !== expected) throw new Error(`${filename}：第 ${index + 1} 题解析序号异常`);
    const choices = bySource.get(ordered.sourceLabel) ?? [ordered];
    const ranked = choices.map((candidate) => ({ score: diceSimilarity(base.stem, candidate.annotatedStem), candidate })).sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const merged: AnalysisCandidate = { ...ordered };
    let pairingMode = "validated-sequence-fallback";
    if (best.score >= 0.48) {
      merged.annotatedStem = best.candidate.annotatedStem;
      merged.annotatedStemRich = best.candidate.annotatedStemRich;
      merged.annotatedOptions = best.candidate.annotatedOptions;
      merged.annotatedOptionRich = best.candidate.annotatedOptionRich;
      pairingMode = "text-and-sequence";
    } else {
      merged.annotatedStem = base.stem;
      merged.annotatedStemRich = base.stemRich;
      merged.annotatedOptions = base.options;
      merged.annotatedOptionRich = base.optionRich;
    }
    const similar = ranked.filter((item) => item.score >= best.score - 0.08).map((item) => item.candidate);
    for (const field of ["answer", "typeAndPassage", "practicalAnalysis", "source", "sourceLabel", "accuracy"] as const) {
      if (!merged[field]) {
        const found = similar.find((candidate) => candidate[field]);
        if (found) (merged as unknown as Record<string, unknown>)[field] = found[field];
      }
    }
    Object.assign(base, merged);
    const optionValues = new Map<string, string>();
    const sequenceLimit = questionType(base.typeAndPassage).includes("语句排序") ? sortingSequenceLimit(base.stem) : undefined;
    const baseComplete = base.options.length === 4 && base.options.every((option) => option.content.trim());
    const annotatedSources = [ordered.annotatedOptions, best.candidate.annotatedOptions, ...choices.map((candidate) => candidate.annotatedOptions)];
    const sources = baseComplete ? [base.options, ...annotatedSources] : [...annotatedSources, base.options];
    for (const source of sources) for (const option of source ?? []) if (LABELS.includes(option.label) && option.content && !optionValues.has(option.label)) optionValues.set(option.label, cleanOption(option.content, sequenceLimit));
    const richSources = [ordered.annotatedOptionRich, best.candidate.annotatedOptionRich, ...choices.map((candidate) => candidate.annotatedOptionRich)];
    for (const source of richSources) for (const [label, rich] of Object.entries(source || {})) {
      const content = cleanOption(runsText(rich), sequenceLimit);
      if (LABELS.includes(label) && content && !optionValues.has(label)) optionValues.set(label, content);
    }
    const repairs = KNOWN_OPTION_REPAIRS[`${base.setNumber}-${base.localNumber}`] ?? {};
    Object.entries(repairs).forEach(([label, content]) => optionValues.set(label, content));
    base.options = LABELS.filter((label) => optionValues.has(label)).map((label) => ({ label, content: optionValues.get(label)! }));
    base.optionRich = Object.fromEntries(base.options.map((option) => [option.label, [{ text: option.content }]]));
    if (!base.answer) {
      const inferred = /(?:锁定|答案为|对应)\s*([A-D])\s*选项|([A-D])\s*选项[^。；\n]{0,40}当选/.exec(base.practicalAnalysis ?? "");
      base.answer = (inferred?.[1] || inferred?.[2] || "").toUpperCase() || null;
    }
    if (!base.typeAndPassage) base.typeAndPassage = `${inferType(base.stem)}+科普介绍文章`;
    base.matchScore = Math.max(best.score, diceSimilarity(base.stem, ordered.annotatedStem));
    base.pairingMode = pairingMode;
  });
}

function markerToken(text: string) {
  const position = text.indexOf(NOTE_LABEL);
  if (position < 0) return null;
  const prefix = text.slice(0, position).trimEnd();
  let index = prefix.length - 1;
  while (index >= 0 && (markerChars.has(prefix[index]) || /\s/.test(prefix[index])) && prefix.length - index <= 8) index -= 1;
  const token = prefix.slice(index + 1).replace(/\s+/g, "");
  if (!token) return null;
  const values = Array.from(token).flatMap((char) => circledValues.has(char) ? [circledValues.get(char)!] : /\d/.test(char) ? [Number(char)] : []);
  if (!values.length) return { token, number: null };
  return { token, number: values.length === 1 ? values[0] : Number(values.map((value) => value % 10).join("")) };
}

function extractNotes(document: ParsedDocument, expectedGroups: number) {
  const records: ParsedNote[] = [];
  let current: { marker: string; number: number | null; parts: string[] } | null = null;
  const finish = () => {
    if (!current) return;
    const content = current.parts.map(compactText).filter((value) => value && !isNoise(value)).join("\n").trim();
    records.push({ marker: current.marker, number: current.number, content });
    current = null;
  };
  for (const paragraph of document.leaf) {
    const text = compactText(paragraph.text);
    if (!text) continue;
    if (text.includes(NOTE_LABEL)) {
      finish();
      const token = markerToken(text);
      if (!token) continue;
      const suffix = text.split(NOTE_LABEL, 2)[1].replace(/^[：: ]+/, "");
      current = { marker: token.token, number: token.number, parts: suffix ? [suffix] : [] };
    } else if (current) {
      if (ANALYSIS_START.test(text) || [ANSWER_LABEL, PRACTICAL_LABEL, "【题型"].some((boundary) => text.includes(boundary))) finish();
      else current.parts.push(text);
    }
  }
  finish();
  const groups: ParsedNote[][] = [];
  let group: ParsedNote[] = [];
  for (const record of records) {
    if (record.number === 1 && group.length) { groups.push(group); group = []; }
    group.push(record);
  }
  if (group.length) groups.push(group);
  while (groups.length < expectedGroups) {
    let best: { score: number; groupIndex: number; cut: number } | null = null;
    groups.forEach((values, groupIndex) => {
      if (values.length < 45) return;
      for (let cut = 15; cut < values.length - 14; cut += 1) {
        const previous = values[cut - 1].number;
        const following = values[cut].number;
        if (previous == null || following == null || previous < 18 || following > 6) continue;
        const score = Math.abs(cut - 35) + Math.abs(values.length - cut - 35);
        if (!best || score < best.score) best = { score, groupIndex, cut };
      }
    });
    const split = best as { score: number; groupIndex: number; cut: number } | null;
    if (!split) break;
    const values = groups[split.groupIndex];
    groups.splice(split.groupIndex, 1, values.slice(0, split.cut), values.slice(split.cut));
  }
  return groups;
}

function extractInlineMarkers(text: string) {
  return [...new Set(Array.from(text).flatMap((char) => circledValues.has(char) ? [circledValues.get(char)!] : []))];
}

function noteSimilarity(note: string, question: WorkingQuestion) {
  return diceSimilarity(note.slice(0, 240), [question.annotatedStem, question.practicalAnalysis, question.stem, question.typeAndPassage].filter(Boolean).join(" "));
}

function attachNotes(document: ParsedDocument, bases: WorkingQuestion[]) {
  const expectedGroups = Math.ceil(bases.length / 20);
  const groups = extractNotes(document, expectedGroups);
  bases.forEach((question) => {
    const combined = [question.annotatedStem, question.practicalAnalysis, ...(question.annotatedOptions ?? []).map((option) => option.content)].filter(Boolean).join(" ");
    question.inlineMarkers = extractInlineMarkers(combined);
    question.notes = [];
  });
  let attached = 0;
  groups.slice(0, expectedGroups).forEach((notes, setOffset) => {
    const questions = bases.slice(setOffset * 20, (setOffset + 1) * 20);
    notes.forEach((note, order) => {
      if (!note.content.trim() || !questions.length) return;
      const eligible = questions.filter((question) => note.number != null && question.inlineMarkers?.includes(note.number));
      const pool = eligible.length ? eligible : questions;
      const ranked = pool.map((question) => ({ question, score: noteSimilarity(note.content, question) })).sort((a, b) => b.score - a.score);
      ranked[0].question.notes!.push({ ...note, matchScore: ranked[0].score, order });
      attached += 1;
    });
  });
  return { attached, groups: groups.length, expectedGroups };
}

function difficulty(accuracy?: number | null): ImportedQuestion["difficulty"] {
  if (accuracy == null || accuracy >= 70) return "基础";
  if (accuracy >= 45) return "进阶";
  return "挑战";
}

function insertRichSegment(segments: RichTextSegment[], position: number, inserted: RichTextSegment) {
  const result: RichTextSegment[] = [];
  let consumed = 0;
  let done = false;
  for (const segment of segments) {
    const next = consumed + segment.text.length;
    if (!done && position >= consumed && position <= next) {
      const offset = position - consumed;
      if (offset > 0) result.push({ ...segment, text: segment.text.slice(0, offset) });
      result.push(inserted);
      if (offset < segment.text.length) result.push({ ...segment, text: segment.text.slice(offset) });
      done = true;
    } else result.push(segment);
    consumed = next;
  }
  if (!done) result.push(inserted);
  return result;
}

function splitSortingRich(segments: RichTextSegment[]) {
  const chars = segments.flatMap((segment) => Array.from(segment.text).map((text) => ({ ...segment, text })));
  const text = chars.map((char) => char.text).join("");
  const breaks = new Set<number>();
  for (let index = 0; index < text.length; index += 1) {
    if (circledValues.has(text[index]) && index > 0 && text[index - 1] !== "\n") breaks.add(index);
  }
  const prompt = text.search(/(?:将以上|将下列)/);
  if (prompt > 0 && text[prompt - 1] !== "\n") breaks.add(prompt);
  if (!breaks.size) return segments;
  const result: RichTextSegment[] = [];
  const append = (segment: RichTextSegment) => {
    const previous = result.at(-1);
    if (previous && Boolean(previous.bold) === Boolean(segment.bold) && Boolean(previous.underline) === Boolean(segment.underline) && Boolean(previous.italic) === Boolean(segment.italic)) previous.text += segment.text;
    else result.push({ text: segment.text, ...(segment.bold ? { bold: true } : {}), ...(segment.underline ? { underline: true } : {}), ...(segment.italic ? { italic: true } : {}) });
  };
  chars.forEach((char, index) => {
    if (breaks.has(index)) append({ text: "\n" });
    append(char);
  });
  return result;
}

function repairQuestionFormatting(question: WorkingQuestion) {
  if (questionType(question.typeAndPassage).includes("语句排序")) {
    question.stemRich = splitSortingRich(question.stemRich);
    question.stem = question.stemRich.map((run) => run.text).join("").replace(/^\n/, "");
    if (question.annotatedStemRich?.length) {
      question.annotatedStemRich = splitSortingRich(question.annotatedStemRich);
      question.annotatedStem = question.annotatedStemRich.map((run) => run.text).join("").replace(/^\n/, "");
    }
  }
  if (!questionType(question.typeAndPassage).includes("语句填入")) return;
  let rich = question.stemRich.map((segment) => ({ ...segment }));
  rich = rich.flatMap((segment) => {
    if (segment.underline || !/ {3,}/.test(segment.text)) return [segment];
    const parts = segment.text.split(/( {3,})/);
    return parts.filter(Boolean).map((text) => /^ {3,}$/.test(text) ? { text: "\u00a0".repeat(Math.max(10, text.length)), underline: true } : { ...segment, text });
  });
  const hasBlank = rich.some((segment) => segment.underline && /^[\s\u00a0_]+$/.test(segment.text));
  if (!hasBlank) {
    const plain = rich.map((segment) => segment.text).join("");
    const firstVisible = plain.search(/\S/);
    const startsWithPunctuation = firstVisible >= 0 && /^[，。；：！？,.?]/.test(plain.slice(firstVisible));
    const prompt = /\n(?:填入|承接|将下列)/.exec(plain);
    const position = startsWithPunctuation ? firstVisible : prompt?.index ?? plain.length;
    rich = insertRichSegment(rich, position, { text: "\u00a0".repeat(14), underline: true });
  }
  question.stemRich = rich;
  question.stem = rich.map((segment) => segment.underline && /^[\s\u00a0_]+$/.test(segment.text) ? "__________" : segment.text.replaceAll("\u00a0", " ")).join("").trim();
}

function questionType(typeAndPassage?: string | null) {
  return typeAndPassage?.split(/[+＋]/, 1)[0].trim() || "片段阅读";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildRecord(question: WorkingQuestion, globalNumber: number): Promise<ImportedQuestion> {
  const practical = (question.practicalAnalysis ?? "").trim();
  const notes = question.notes ?? [];
  const explanation = [practical, notes.length ? `花生批注：\n${notes.map((note) => `${note.marker} ${note.content}`).join("\n")}` : ""].filter(Boolean).join("\n\n");
  const details = {
    globalNumber,
    setNumber: question.setNumber,
    localNumber: question.localNumber,
    sourceLabel: question.sourceLabel,
    accuracy: question.accuracy,
    typeAndPassage: question.typeAndPassage,
    stemRich: question.stemRich,
    optionRich: question.optionRich,
    annotatedStemRich: question.annotatedStemRich,
    annotatedOptionRich: question.annotatedOptionRich,
    practicalAnalysis: practical,
    notes: notes.map((note) => ({ marker: note.marker, content: note.content })),
    pairingMode: question.pairingMode,
    matchScore: question.matchScore
  };
  const record = {
    type: questionType(question.typeAndPassage),
    stem: question.stem,
    options: question.options,
    answer: question.answer ?? "",
    explanation,
    source: question.source || "片段阅读",
    difficulty: difficulty(question.accuracy),
    status: "published" as const,
    details
  };
  return { ...record, importKey: await sha256Hex(JSON.stringify([record.stem, record.options, record.source])) };
}

function fileOrder(name: string) {
  if (name.includes("上")) return `0-${name}`;
  if (name.includes("下")) return `1-${name}`;
  return `2-${name}`;
}

export async function parseDocxQuestionPairs(bookFiles: File[], analysisFiles: File[], onProgress?: (message: string, value: number) => void): Promise<ImportPreview> {
  if (!bookFiles.length || !analysisFiles.length) throw new Error("请同时选择题本和解析 Word 文件");
  if (bookFiles.length !== analysisFiles.length) throw new Error(`题本文件 ${bookFiles.length} 个、解析文件 ${analysisFiles.length} 个，数量必须一致`);
  const books = [...bookFiles].sort((a, b) => fileOrder(a.name).localeCompare(fileOrder(b.name), "zh-CN"));
  const analyses = [...analysisFiles].sort((a, b) => fileOrder(a.name).localeCompare(fileOrder(b.name), "zh-CN"));
  const warnings: string[] = [];
  const pairs: ImportPreview["pairs"] = [];
  const working: WorkingQuestion[] = [];
  let nextSet = 1;
  for (let index = 0; index < books.length; index += 1) {
    onProgress?.(`正在读取题本：${books[index].name}`, index / (books.length * 2));
    const bookDocument = await readDocument(books[index]);
    const questions = parseBook(bookDocument, nextSet, books[index].name);
    onProgress?.(`正在匹配解析：${analyses[index].name}`, (index + 0.5) / (books.length * 2));
    const analysisDocument = await readDocument(analyses[index]);
    mergeAnalysis(analysisDocument, questions, analyses[index].name);
    const noteResult = attachNotes(analysisDocument, questions);
    if (noteResult.groups !== noteResult.expectedGroups) warnings.push(`${analyses[index].name}：批注组识别 ${noteResult.groups}/${noteResult.expectedGroups}，请抽查预览`);
    questions.forEach(repairQuestionFormatting);
    pairs.push({ book: books[index].name, analysis: analyses[index].name, count: questions.length });
    working.push(...questions);
    nextSet += questions.length / 20;
  }
  const invalid = working.flatMap((question, index) => {
    const errors: string[] = [];
    if (question.options.map((option) => option.label).join("") !== "ABCD") errors.push("选项不完整");
    if (!question.stem.trim()) errors.push("题干缺失");
    if (!question.answer || !LABELS.includes(question.answer)) errors.push("参考答案缺失");
    if (!question.practicalAnalysis?.trim()) errors.push("实战解析缺失");
    return errors.map((error) => `第 ${index + 1} 题${error}`);
  });
  if (invalid.length) throw new Error(`导入校验未通过：${invalid.slice(0, 12).join("；")}${invalid.length > 12 ? "……" : ""}`);
  onProgress?.("正在生成导入数据", 0.9);
  const questions = await Promise.all(working.map((question, index) => buildRecord(question, index + 1)));
  onProgress?.("解析完成", 1);
  return {
    questions,
    warnings,
    pairs,
    summary: {
      total: questions.length,
      paired: working.filter((question) => (question.matchScore ?? 0) >= 0.48 || question.pairingMode === "validated-sequence-fallback").length,
      withPractical: working.filter((question) => question.practicalAnalysis?.trim()).length,
      withNotes: working.filter((question) => question.notes?.length).length,
      withUnderline: working.filter((question) => [...question.stemRich, ...(question.annotatedStemRich ?? [])].some((run) => run.underline)).length,
      sequenceFallbacks: working.filter((question) => question.pairingMode === "validated-sequence-fallback").length
    }
  };
}
