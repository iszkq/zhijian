export type CategorySlug = "politics" | "knowledge" | "language" | "math" | "data";

export interface Category {
  id: number;
  slug: CategorySlug;
  name: string;
  shortName: string;
  description: string;
  color: string;
  softColor: string;
  questionCount: number;
}

export interface Option {
  label: string;
  content: string;
}

export interface Question {
  id: number;
  categoryId: number;
  categoryName: string;
  type: "单选题";
  stem: string;
  options: Option[];
  answer: string;
  explanation: string;
  source: string;
  difficulty: "基础" | "进阶" | "挑战";
}

export interface PracticeConfig {
  categoryIds: number[];
  count: number;
  durationMinutes: number | null;
}

export interface AnswerState {
  selected: string | null;
  marked: boolean;
}

export interface Attempt {
  id: string;
  title: string;
  categoryNames: string[];
  questionIds: number[];
  answers: Record<number, AnswerState>;
  startedAt: string;
  submittedAt: string;
  durationSeconds: number;
  timeLimitSeconds: number | null;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  score: number;
}

export type ViewName = "home" | "practice" | "report" | "history" | "wrongbook";
