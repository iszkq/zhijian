import type { Attempt, AuthUser, Category, Question } from "./types";

type AuthResult = { user: AuthUser; error?: never } | { user?: never; error: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "请求失败，请稍后重试");
  return payload;
}

export const adminRequest = request;

export async function fetchCategories(): Promise<Category[]> {
  const payload = await request<{ data: Category[] }>("/api/categories");
  return payload.data;
}

export async function fetchPracticeQuestions(categoryIds: number[], count: number, questionType?: string): Promise<Question[]> {
  const params = new URLSearchParams({ categoryIds: categoryIds.join(","), count: String(count) });
  if (questionType) params.set("types", questionType);
  const payload = await request<{ data: Question[] }>(`/api/questions?${params}`);
  return payload.data;
}

export async function uploadQuestionImage(file: File): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append("file", file);
  return request<{ key: string; url: string }>("/api/admin/media", { method: "POST", body: form });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const result = await request<{ user: AuthUser }>("/api/auth/me");
    return result.user;
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  try {
    return await request<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password })
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "登录失败" };
  }
}

export async function register(username: string, displayName: string, password: string): Promise<AuthResult> {
  try {
    return await request<{ user: AuthUser }>("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, displayName, password })
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "注册失败" };
  }
}

export async function logout() {
  try {
    await request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  } catch {
    // The local UI still clears the signed-in state if the network is interrupted.
  }
}

export async function syncAttempt(attempt: Attempt) {
  try {
    await request<{ ok: boolean }>("/api/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(attempt)
    });
  } catch {
    // Per-account localStorage remains as an offline fallback.
  }
}

export async function fetchCloudAttempts(): Promise<Attempt[]> {
  try {
    const payload = await request<{ data: Attempt[] }>("/api/attempts");
    return payload.data;
  } catch {
    return [];
  }
}
