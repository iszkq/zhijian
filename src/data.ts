import importedQuestions from "./fragmentQuestions.json";
import type { Category, Question } from "./types";

export const categories: Category[] = [
  { id: 1, slug: "politics", name: "政治理论", shortName: "政治", description: "马克思主义、党史与时政热点", color: "#6c5ce7", softColor: "#eeeafd", questionCount: 0 },
  { id: 2, slug: "knowledge", name: "常识判断", shortName: "常识", description: "法律、科技、人文与地理常识", color: "#f59e42", softColor: "#fff3e5", questionCount: 0 },
  { id: 3, slug: "language", name: "言语理解与表达", shortName: "言语", description: "片段阅读、选词填空与语句表达", color: "#21a179", softColor: "#e5f8f1", questionCount: 600 },
  { id: 4, slug: "math", name: "数量关系", shortName: "数量", description: "数学运算与数字推理", color: "#ef5da8", softColor: "#fdebf4", questionCount: 0 },
  { id: 5, slug: "data", name: "资料分析", shortName: "资料", description: "增长率、比重与综合分析", color: "#3b82f6", softColor: "#eaf2ff", questionCount: 0 }
];

export const questions = importedQuestions as Question[];

export const getQuestions = (categoryIds: number[], count: number): Question[] => {
  const pool = questions.filter((item) => categoryIds.includes(item.categoryId));
  return [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length));
};
