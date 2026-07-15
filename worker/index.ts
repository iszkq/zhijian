import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use("/api/*", cors({
  origin: "*",
  allowHeaders: ["content-type", "x-user-key"],
  allowMethods: ["GET", "POST", "OPTIONS"]
}));

app.get("/api/health", (c) => c.json({ ok: true, service: "知简 API" }));

app.get("/api/categories", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.slug, c.name, c.short_name AS shortName, c.description,
           c.color, c.soft_color AS softColor, COUNT(q.id) AS questionCount
    FROM categories c LEFT JOIN questions q ON q.category_id = c.id AND q.status = 'published'
    GROUP BY c.id ORDER BY c.sort_order
  `).all();
  return c.json({ data: results });
});

app.get("/api/questions", async (c) => {
  const ids = (c.req.query("categoryIds") || "1,2,3,4,5").split(",").map(Number).filter(Boolean).slice(0, 5);
  const count = Math.min(100, Math.max(1, Number(c.req.query("count") || 10)));
  const placeholders = ids.map(() => "?").join(",");
  const statement = c.env.DB.prepare(`
    SELECT q.id, q.category_id AS categoryId, c.name AS categoryName, q.type, q.stem,
           q.options_json AS optionsJson, q.answer, q.explanation, q.source, q.difficulty
    FROM questions q JOIN categories c ON c.id = q.category_id
    WHERE q.status = 'published' AND q.category_id IN (${placeholders})
    ORDER BY RANDOM() LIMIT ?
  `).bind(...ids, count);
  const { results } = await statement.all<Record<string, unknown>>();
  return c.json({ data: results.map((row) => ({ ...row, options: JSON.parse(String(row.optionsJson)), optionsJson: undefined })) });
});

const attemptSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(100),
  categoryNames: z.array(z.string()).max(10),
  questionIds: z.array(z.number().int()).min(1).max(100),
  answers: z.record(z.string(), z.object({ selected: z.string().nullable(), marked: z.boolean() })),
  startedAt: z.string(),
  submittedAt: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  timeLimitSeconds: z.number().int().positive().nullable(),
  correctCount: z.number().int().nonnegative(),
  wrongCount: z.number().int().nonnegative(),
  unansweredCount: z.number().int().nonnegative(),
  score: z.number().min(0).max(100)
});

app.post("/api/attempts", zValidator("json", attemptSchema), async (c) => {
  const userKey = c.req.header("x-user-key") || "anonymous";
  const attempt = c.req.valid("json");
  await c.env.DB.prepare(`
    INSERT INTO attempts (id, user_key, title, score, correct_count, wrong_count, unanswered_count,
      question_count, duration_seconds, started_at, submitted_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
  `).bind(
    attempt.id, userKey, attempt.title, attempt.score, attempt.correctCount, attempt.wrongCount,
    attempt.unansweredCount, attempt.questionIds.length, attempt.durationSeconds,
    attempt.startedAt, attempt.submittedAt, JSON.stringify(attempt)
  ).run();
  return c.json({ ok: true }, 201);
});

app.get("/api/attempts", async (c) => {
  const userKey = c.req.header("x-user-key") || "anonymous";
  const { results } = await c.env.DB.prepare(`
    SELECT payload_json FROM attempts WHERE user_key = ? ORDER BY submitted_at DESC LIMIT 100
  `).bind(userKey).all<{ payload_json: string }>();
  return c.json({ data: results.map((row) => JSON.parse(row.payload_json)) });
});

app.notFound(async (c) => {
  if (c.req.path.startsWith("/api/")) return c.json({ error: "接口不存在" }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: "服务暂时不可用" }, 500);
});

export default app;
