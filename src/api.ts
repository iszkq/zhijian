import type { Attempt } from "./types";

const USER_KEY = "zhixing-user-key";

const userKey = () => {
  let value = localStorage.getItem(USER_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(USER_KEY, value);
  }
  return value;
};

export async function syncAttempt(attempt: Attempt) {
  try {
    await fetch("/api/attempts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-key": userKey() },
      body: JSON.stringify(attempt)
    });
  } catch {
    // Vite-only demo mode intentionally keeps localStorage as an offline fallback.
  }
}

export async function fetchCloudAttempts(): Promise<Attempt[]> {
  try {
    const response = await fetch("/api/attempts", { headers: { "x-user-key": userKey() } });
    if (!response.ok) return [];
    const payload = await response.json() as { data: Attempt[] };
    return payload.data;
  } catch {
    return [];
  }
}
