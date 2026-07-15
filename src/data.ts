import importedQuestions from "./fragmentQuestions.json";
import type { Category, Question } from "./types";

export const questions = importedQuestions as Question[];
const cleanType = (value: string) => {
  const text = value.replace(/[①-㊿0-9]+$/g, "").trim();
  const known: Array<[string, string]> = [["中心理解", "中心理解题"], ["语句填入", "语句填入类"], ["语句排序", "语句排序类"], ["下文推断", "下文推断类"], ["细节判断", "细节判断类"], ["标题", "标题拟定类"], ["词句理解", "词句理解题"], ["观点态度", "观点态度题"], ["上文推断", "上文推断类"]];
  return known.find(([prefix]) => text.includes(prefix))?.[1] || text || "片段阅读";
};
const languageTypeTotals = questions.filter((question) => question.categoryId === 3).reduce<Record<string, { types: string[]; count: number }>>((counts, question) => {
  const label = cleanType(question.type);
  counts[label] ||= { types: [], count: 0 };
  counts[label].types.push(question.type);
  counts[label].count += 1;
  return counts;
}, {});
const languageTypeCounts = Object.entries(languageTypeTotals).map(([label, value]) => ({ type: [...new Set(value.types)].join(","), label, count: value.count }));

export const categories: Category[] = [
  { id: 1, slug: "politics", name: "政治理论", shortName: "政治", description: "马克思主义、党史与时政热点", color: "#6c5ce7", softColor: "#eeeafd", questionCount: 0 },
  { id: 2, slug: "knowledge", name: "常识判断", shortName: "常识", description: "法律、科技、人文与地理常识", color: "#f59e42", softColor: "#fff3e5", questionCount: 0 },
  { id: 3, slug: "language", name: "言语理解与表达", shortName: "言语", description: "片段阅读、选词填空与语句表达", color: "#21a179", softColor: "#e5f8f1", questionCount: 600, typeCounts: languageTypeCounts },
  { id: 4, slug: "math", name: "数量关系", shortName: "数量", description: "数学运算与数字推理", color: "#ef5da8", softColor: "#fdebf4", questionCount: 0 },
  { id: 5, slug: "data", name: "资料分析", shortName: "资料", description: "增长率、比重与综合分析", color: "#3b82f6", softColor: "#eaf2ff", questionCount: 0 }
];

export const getQuestions = (categoryIds: number[], count: number, questionType?: string): Question[] => {
  const allowedTypes = questionType?.split(",") || [];
  const pool = questions.filter((item) => categoryIds.includes(item.categoryId) && (!allowedTypes.length || allowedTypes.includes(item.type)));
  return [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length));
};
