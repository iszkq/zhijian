import type { Attempt } from "./types";

const keyFor = (userId: string) => `zhijian-attempts-v2:${userId}`;

export const loadAttempts = (userId: string): Attempt[] => {
  try {
    return JSON.parse(localStorage.getItem(keyFor(userId)) || "[]") as Attempt[];
  } catch {
    return [];
  }
};

export const saveAttempt = (userId: string, attempt: Attempt) => {
  const items = [attempt, ...loadAttempts(userId).filter((item) => item.id !== attempt.id)].slice(0, 100);
  localStorage.setItem(keyFor(userId), JSON.stringify(items));
};

export const clearAttempts = (userId: string) => localStorage.removeItem(keyFor(userId));
