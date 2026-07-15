export type CategorySlug = string;

export interface Category {
  id: number;
  slug: CategorySlug;
  name: string;
  shortName: string;
  description: string;
  color: string;
  softColor: string;
  questionCount: number;
  typeCounts?: Array<{ type: string; label: string; count: number }>;
}

export interface Option {
  label: string;
  content: string;
}

export interface RichTextSegment {
  text: string;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
}

export interface QuestionDetails {
  set: number;
  number: number;
  sourceMatch?: number;
  typeLabel?: string | null;
  missingOptionLabels?: string[];
  annotatedStem?: RichTextSegment[];
  annotatedOptions?: Array<{ label: string; rich: RichTextSegment[] }>;
  practical?: string;
  notes?: Array<{ marker: string; text: string }>;
}

export interface Question {
  id: number;
  categoryId: number;
  categoryName: string;
  type: string;
  stem: string;
  options: Option[];
  answer: string;
  explanation: string;
  source: string;
  stemRich?: RichTextSegment[];
  details?: QuestionDetails;
  difficulty: "基础" | "进阶" | "挑战";
  imageUrl?: string | null;
  status?: "published" | "draft";
}

export interface PracticeConfig {
  categoryIds: number[];
  count: number;
  durationMinutes: number | null;
  questionType?: string;
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
  questionSnapshots?: Question[];
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
  role: "user" | "admin";
  status: "active" | "disabled";
}

export type ViewName = "home" | "practice" | "report" | "history" | "wrongbook" | "admin";
