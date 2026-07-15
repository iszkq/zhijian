import type { Attempt } from "./types";

const KEY = "zhixing-attempts-v1";

export const loadAttempts = (): Attempt[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]") as Attempt[];
  } catch {
    return [];
  }
};

export const saveAttempt = (attempt: Attempt) => {
  const items = [attempt, ...loadAttempts().filter((item) => item.id !== attempt.id)].slice(0, 100);
  localStorage.setItem(KEY, JSON.stringify(items));
};

export const clearAttempts = () => localStorage.removeItem(KEY);
