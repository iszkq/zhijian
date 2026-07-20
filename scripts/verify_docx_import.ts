import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseDocxQuestionPairs } from "../src/docxImporter";

const separator = process.argv.indexOf("--analysis");
if (separator < 3 || separator === process.argv.length - 1) {
  throw new Error("用法：tsx scripts/verify_docx_import.ts <题本...> --analysis <解析...>");
}

const toFiles = async (paths: string[]) => Promise.all(paths.map(async (path) => new File(
  [await readFile(path)],
  basename(path),
  { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }
)));

const result = await parseDocxQuestionPairs(
  await toFiles(process.argv.slice(2, separator)),
  await toFiles(process.argv.slice(separator + 1)),
  (message, value) => console.error(`${Math.round(value * 100)}% ${message}`)
);

console.log(JSON.stringify({
  summary: result.summary,
  pairs: result.pairs,
  warnings: result.warnings,
  first: {
    stem: result.questions[0]?.stem.slice(0, 80),
    answer: result.questions[0]?.answer,
    details: result.questions[0]?.details
  },
  last: {
    stem: result.questions.at(-1)?.stem.slice(0, 80),
    answer: result.questions.at(-1)?.answer
  },
  checks: {
    blankOptionQuestions: result.questions.filter((question) => question.options.some((option) => !option.content.trim())).length,
    emptyStemQuestions: result.questions.filter((question) => !question.stem.trim()).length,
    fillWithoutUnderline: result.questions.filter((question) => question.type.includes("语句填入") && !(question.details.stemRich as Array<{ underline?: boolean }>).some((run) => run.underline)).length,
    sortWithoutLineBreaks: result.questions.filter((question) => question.type.includes("语句排序") && !question.stem.includes("\n②")).length,
    samples: [80, 290, 454].map((number) => {
      const question = result.questions[number - 1];
      return { number, stem: question.stem.slice(0, 160), options: question.options, stemRich: question.details.stemRich, annotatedOptions: question.details.annotatedOptionRich };
    })
  }
}, null, 2));
