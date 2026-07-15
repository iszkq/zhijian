import { Hono, type Context } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  MEDIA: R2Bucket;
};

type WorkerEnv = { Bindings: Bindings; Variables: { authUser: SessionUserRow } };
type AppContext = Context<WorkerEnv>;

type SessionUserRow = {
  id: string;
  username: string;
  display_name: string;
  created_at: string;
  role: "user" | "admin";
  status: "active" | "disabled";
};

const app = new Hono<WorkerEnv>();
const encoder = new TextEncoder();
const SESSION_COOKIE = "zhijian_session";

function parseQuestionDetails(value: unknown) {
  if (!value) return undefined;
  try {
    const details = JSON.parse(String(value)) as Record<string, any>;
    const optionRich = details.annotatedOptionRich && typeof details.annotatedOptionRich === "object"
      ? Object.entries(details.annotatedOptionRich).map(([label, rich]) => ({ label, rich }))
      : details.annotatedOptions;
    return {
      ...details,
      set: details.set ?? details.setNumber,
      number: details.number ?? details.localNumber,
      typeLabel: details.typeLabel ?? details.typeAndPassage,
      stemRich: details.stemRich,
      annotatedStem: details.annotatedStem ?? details.annotatedStemRich,
      annotatedOptions: optionRich,
      practical: details.practical ?? details.practicalAnalysis,
      notes: Array.isArray(details.notes) ? details.notes.map((note: any) => ({ marker: String(note.marker ?? ""), text: String(note.text ?? note.content ?? "") })) : []
    };
  } catch {
    return undefined;
  }
}
function cleanQuestionType(value: unknown) {
  const text = String(value || "片段阅读").replace(/[①-㊿0-9]+$/g, "").trim();
  const known: Array<[string, string]> = [
    ["中心理解", "中心理解题"], ["语句填入", "语句填入类"], ["语句排序", "语句排序类"],
    ["下文推断", "下文推断类"], ["细节判断", "细节判断类"], ["标题", "标题拟定类"],
    ["词句理解", "词句理解题"], ["观点态度", "观点态度题"], ["上文推断", "上文推断类"]
  ];
  return known.find(([prefix]) => text.includes(prefix))?.[1] || text || "片段阅读";
}
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const bytesToBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const randomToken = (length = 32) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

async function sha256(value: string) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function hashPassword(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  // Cloudflare Workers caps PBKDF2 at 100,000 iterations in production.
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, key, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function getCookie(c: AppContext, name: string) {
  const cookie = c.req.header("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function setSessionCookie(c: AppContext, token: string, maxAge: number) {
  const secure = new URL(c.req.url).protocol === "https:" ? "; Secure" : "";
  c.header("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

const publicUser = (row: SessionUserRow) => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  createdAt: row.created_at,
  role: row.role,
  status: row.status
});

async function getSessionUser(c: AppContext) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  return c.env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.created_at, u.role, u.status
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'
  `).bind(tokenHash).first<SessionUserRow>();
}

async function createSession(c: AppContext, userId: string) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_sessions WHERE expires_at <= datetime('now')"),
    c.env.DB.prepare("INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(tokenHash, userId, expiresAt)
  ]);
  setSessionCookie(c, token, SESSION_MAX_AGE);
}

app.get("/api/health", (c) => c.json({ ok: true, service: "知简 API" }));

app.get("/api/health/ready", async (c) => {
  const readiness = {
    database: false,
    usersTable: false,
    sessionsTable: false,
    roleColumn: false,
    statusColumn: false,
    imageColumn: false,
    detailsColumn: false,
    importTables: false,
    passwordCrypto: false
  };
  try {
    const row = await c.env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'users') AS users_table,
        EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'user_sessions') AS sessions_table,
        EXISTS(SELECT 1 FROM pragma_table_info('users') WHERE name = 'role') AS role_column,
        EXISTS(SELECT 1 FROM pragma_table_info('users') WHERE name = 'status') AS status_column,
        EXISTS(SELECT 1 FROM pragma_table_info('questions') WHERE name = 'image_key') AS image_column,
        EXISTS(SELECT 1 FROM pragma_table_info('questions') WHERE name = 'details_json') AS details_column,
        EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'question_imports') AS import_tables
    `).first<Record<string, number>>();
    readiness.database = true;
    readiness.usersTable = Boolean(row?.users_table);
    readiness.sessionsTable = Boolean(row?.sessions_table);
    readiness.roleColumn = Boolean(row?.role_column);
    readiness.statusColumn = Boolean(row?.status_column);
    readiness.imageColumn = Boolean(row?.image_column);
    readiness.detailsColumn = Boolean(row?.details_column);
    readiness.importTables = Boolean(row?.import_tables);
  } catch (error) {
    console.error("readiness database check failed", error);
  }
  try {
    readiness.passwordCrypto = (await hashPassword("readiness-check", new Uint8Array(16))).length > 0;
  } catch (error) {
    console.error("readiness crypto check failed", error);
  }
  const ready = Object.values(readiness).every(Boolean);
  return c.json({ ok: ready, checks: readiness }, ready ? 200 : 503);
});

app.use("/api/admin/*", async (c, next) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);
  if (user.role !== "admin") return c.json({ error: "没有管理员权限" }, 403);
  c.set("authUser", user);
  await next();
});

const registerSchema = z.object({
  username: z.string().trim().min(3, "账号至少3位").max(24, "账号最多24位").regex(/^[A-Za-z0-9_]+$/, "账号只能使用字母、数字和下划线"),
  displayName: z.string().trim().min(1, "请输入昵称").max(20, "昵称最多20个字"),
  password: z.string().min(8, "密码至少8位").max(72, "密码最多72位")
});

app.post("/api/auth/register", zValidator("json", registerSchema, (result, c) => {
  if (!result.success) return c.json({ error: result.error.issues[0]?.message || "注册信息不完整" }, 400);
}), async (c) => {
  const data = c.req.valid("json");
  const username = data.username.toLowerCase();
  let existing: Record<string, unknown> | null;
  try {
    existing = await c.env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  } catch (error) {
    console.error("register schema check failed", error);
    return c.json({ error: "账号数据库尚未正确初始化", code: "AUTH_DB_NOT_READY" }, 503);
  }
  if (existing) return c.json({ error: "这个账号已经被使用" }, 409);

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const userId = crypto.randomUUID();
  let passwordHash: string;
  try {
    passwordHash = await hashPassword(data.password, salt);
  } catch (error) {
    console.error("register password hashing failed", error);
    return c.json({ error: "密码安全加密失败，请稍后重试", code: "AUTH_CRYPTO_FAILED" }, 500);
  }
  try {
    await c.env.DB.prepare(`
      INSERT INTO users (id, username, display_name, password_hash, password_salt)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, username, data.displayName, passwordHash, bytesToBase64(salt)).run();
  } catch (error) {
    console.error("register user insert failed", error);
    return c.json({ error: "账号写入失败，请检查数据库配置", code: "AUTH_USER_WRITE_FAILED" }, 500);
  }
  try {
    await createSession(c, userId);
  } catch (error) {
    console.error("register session creation failed", error);
    await c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run().catch(() => undefined);
    return c.json({ error: "登录会话创建失败，请稍后重试", code: "AUTH_SESSION_FAILED" }, 500);
  }
  return c.json({ user: { id: userId, username, displayName: data.displayName, createdAt: new Date().toISOString(), role: "user", status: "active" } }, 201);
});

const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号"),
  password: z.string().min(1, "请输入密码")
});

app.post("/api/auth/login", zValidator("json", loginSchema, (result, c) => {
  if (!result.success) return c.json({ error: result.error.issues[0]?.message || "请输入账号和密码" }, 400);
}), async (c) => {
  const data = c.req.valid("json");
  const row = await c.env.DB.prepare(`
    SELECT id, username, display_name, created_at, password_hash, password_salt, role, status
    FROM users WHERE username = ?
  `).bind(data.username.toLowerCase()).first<SessionUserRow & { password_hash: string; password_salt: string }>();
  if (!row) return c.json({ error: "账号或密码不正确" }, 401);
  if (row.status !== "active") return c.json({ error: "账号已被停用，请联系管理员" }, 403);
  const candidate = await hashPassword(data.password, base64ToBytes(row.password_salt));
  if (!safeEqual(candidate, row.password_hash)) return c.json({ error: "账号或密码不正确" }, 401);
  await createSession(c, row.id);
  return c.json({ user: publicUser(row) });
});

app.get("/api/auth/me", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "尚未登录" }, 401);
  return c.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM user_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  setSessionCookie(c, "", 0);
  return c.json({ ok: true });
});

app.get("/api/categories", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.slug, c.name, c.short_name AS shortName, c.description,
           c.color, c.soft_color AS softColor, COUNT(q.id) AS questionCount
    FROM categories c LEFT JOIN questions q ON q.category_id = c.id AND q.status = 'published'
    GROUP BY c.id ORDER BY c.sort_order
  `).all();
  const typeResults = await c.env.DB.prepare(`
    SELECT category_id AS categoryId, type, COUNT(*) AS count
    FROM questions WHERE status = 'published'
    GROUP BY category_id, type ORDER BY category_id, count DESC, type
  `).all<Record<string, unknown>>();
  const typeCounts = new Map<number, Map<string, { types: string[]; count: number }>>();
  for (const row of typeResults.results) {
    const categoryId = Number(row.categoryId);
    const label = cleanQuestionType(row.type);
    const values = typeCounts.get(categoryId) || new Map<string, { types: string[]; count: number }>();
    const current = values.get(label) || { types: [], count: 0 };
    current.types.push(String(row.type));
    current.count += Number(row.count);
    values.set(label, current);
    typeCounts.set(categoryId, values);
  }
  return c.json({ data: results.map((row) => ({
    ...row,
    typeCounts: [...(typeCounts.get(Number(row.id)) || new Map()).entries()].map(([label, value]) => ({ type: value.types.join(","), label, count: value.count }))
  })) });
});

app.get("/api/questions", async (c) => {
  const ids = (c.req.query("categoryIds") || "1,2,3,4,5").split(",").map(Number).filter(Boolean).slice(0, 5);
  const count = Math.min(100, Math.max(1, Number(c.req.query("count") || 10)));
  const types = (c.req.query("types") || "").split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
  const placeholders = ids.map(() => "?").join(",");
  const typePlaceholders = types.map(() => "?").join(",");
  const typeFilter = types.length ? ` AND q.type IN (${typePlaceholders})` : "";
  const statement = c.env.DB.prepare(`
    SELECT q.id, q.category_id AS categoryId, c.name AS categoryName, q.type, q.stem,
           q.options_json AS optionsJson, q.answer, q.explanation, q.source, q.difficulty,
           q.image_key AS imageKey, q.status, q.details_json AS detailsJson
    FROM questions q JOIN categories c ON c.id = q.category_id
    WHERE q.status = 'published' AND q.category_id IN (${placeholders})${typeFilter}
    ORDER BY RANDOM() LIMIT ?
  `).bind(...ids, ...types, count);
  const { results } = await statement.all<Record<string, unknown>>();
  return c.json({ data: results.map((row) => {
    const details = parseQuestionDetails(row.detailsJson);
    return {
      ...row,
      type: cleanQuestionType(row.type),
      options: JSON.parse(String(row.optionsJson)),
      stemRich: details?.stemRich,
      details,
      imageUrl: row.imageKey ? `/api/media/${row.imageKey}` : null,
      optionsJson: undefined,
      imageKey: undefined,
      detailsJson: undefined
    };
  }) });
});

app.get("/api/media/:key", async (c) => {
  const object = await c.env.MEDIA.get(c.req.param("key"));
  if (!object) return c.json({ error: "图片不存在" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

const categorySchema = z.object({
  slug: z.string().trim().min(1).max(40).regex(/^[a-z0-9-]+$/, "分类标识只能使用小写字母、数字和连字符"),
  name: z.string().trim().min(1).max(30),
  shortName: z.string().trim().min(1).max(8),
  description: z.string().trim().max(100).default(""),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  softColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().min(0).max(999).default(0)
});

app.get("/api/admin/categories", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT c.id, c.slug, c.name, c.short_name AS shortName, c.description, c.color,
      c.soft_color AS softColor, c.sort_order AS sortOrder, COUNT(q.id) AS questionCount
    FROM categories c LEFT JOIN questions q ON q.category_id = c.id
    GROUP BY c.id ORDER BY c.sort_order, c.id
  `).all();
  return c.json({ data: results });
});

app.post("/api/admin/categories", zValidator("json", categorySchema), async (c) => {
  const data = c.req.valid("json");
  const result = await c.env.DB.prepare(`
    INSERT INTO categories (slug, name, short_name, description, color, soft_color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(data.slug, data.name, data.shortName, data.description, data.color, data.softColor, data.sortOrder).run();
  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

app.put("/api/admin/categories/:id", zValidator("json", categorySchema), async (c) => {
  const data = c.req.valid("json");
  await c.env.DB.prepare(`
    UPDATE categories SET slug = ?, name = ?, short_name = ?, description = ?, color = ?, soft_color = ?, sort_order = ?
    WHERE id = ?
  `).bind(data.slug, data.name, data.shortName, data.description, data.color, data.softColor, data.sortOrder, Number(c.req.param("id"))).run();
  return c.json({ ok: true });
});

app.delete("/api/admin/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS total FROM questions WHERE category_id = ?").bind(id).first<{ total: number }>();
  if ((count?.total || 0) > 0) return c.json({ error: "该分类下还有题目，请先移动或删除题目" }, 409);
  await c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  return c.json({ ok: true });
});

const adminUserSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_]+$/),
  displayName: z.string().trim().min(1).max(20),
  password: z.string().min(8).max(72),
  role: z.enum(["user", "admin"]).default("user")
});

app.get("/api/admin/users", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role, u.status, u.created_at AS createdAt,
      COUNT(a.id) AS attemptCount
    FROM users u LEFT JOIN attempts a ON a.user_id = u.id
    GROUP BY u.id ORDER BY u.created_at DESC
  `).all();
  return c.json({ data: results });
});

app.post("/api/admin/users", zValidator("json", adminUserSchema), async (c) => {
  const data = c.req.valid("json");
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, role)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, data.username.toLowerCase(), data.displayName, await hashPassword(data.password, salt), bytesToBase64(salt), data.role).run();
  return c.json({ ok: true, id }, 201);
});

const updateUserSchema = z.object({
  displayName: z.string().trim().min(1).max(20),
  role: z.enum(["user", "admin"]),
  status: z.enum(["active", "disabled"])
});

app.put("/api/admin/users/:id", zValidator("json", updateUserSchema), async (c) => {
  const id = c.req.param("id");
  const current = c.get("authUser");
  const data = c.req.valid("json");
  if (id === current.id && (data.role !== "admin" || data.status !== "active")) return c.json({ error: "不能停用自己或取消自己的管理员身份" }, 400);
  await c.env.DB.prepare("UPDATE users SET display_name = ?, role = ?, status = ? WHERE id = ?")
    .bind(data.displayName, data.role, data.status, id).run();
  if (data.status === "disabled") await c.env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id).run();
  return c.json({ ok: true });
});

app.delete("/api/admin/users/:id", async (c) => {
  const id = c.req.param("id");
  if (id === c.get("authUser").id) return c.json({ error: "不能删除当前登录的管理员账号" }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM user_sessions WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM attempts WHERE user_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id)
  ]);
  return c.json({ ok: true });
});

const optionSchema = z.object({ label: z.string().min(1).max(2), content: z.string().trim().min(1).max(500) });
const questionSchema = z.object({
  categoryId: z.number().int().positive(),
  type: z.string().trim().min(1).max(20).default("单选题"),
  stem: z.string().trim().min(1).max(5000),
  options: z.array(optionSchema).min(2).max(6),
  answer: z.string().min(1).max(2),
  explanation: z.string().trim().min(1).max(10000),
  source: z.string().trim().max(100).default("自建题库"),
  difficulty: z.enum(["基础", "进阶", "挑战"]),
  status: z.enum(["published", "draft"]),
  imageKey: z.string().max(200).nullable().optional()
}).refine((data) => data.options.some((option) => option.label === data.answer), { message: "正确答案必须对应一个选项" });

app.get("/api/admin/questions", async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT q.id, q.category_id AS categoryId, c.name AS categoryName, q.type, q.stem,
      q.options_json AS optionsJson, q.answer, q.explanation, q.source, q.difficulty,
      q.status, q.image_key AS imageKey, q.created_at AS createdAt, q.updated_at AS updatedAt
    FROM questions q JOIN categories c ON c.id = q.category_id
    ORDER BY q.updated_at DESC, q.id DESC
  `).all<Record<string, unknown>>();
  return c.json({ data: results.map((row) => ({ ...row, options: JSON.parse(String(row.optionsJson)), imageUrl: row.imageKey ? `/api/media/${row.imageKey}` : null, optionsJson: undefined })) });
});

const importModeSchema = z.enum(["append", "replace"]);
const importQuestionSchema = z.object({
  position: z.number().int().nonnegative().max(100000),
  importKey: z.string().regex(/^[a-f0-9]{64}$/),
  type: z.string().trim().min(1).max(50),
  stem: z.string().trim().min(1).max(15000),
  options: z.array(z.object({ label: z.string().min(1).max(2), content: z.string().trim().min(1).max(2000) })).min(2).max(8),
  answer: z.string().min(1).max(2),
  explanation: z.string().max(50000),
  source: z.string().trim().min(1).max(200),
  difficulty: z.enum(["基础", "进阶", "挑战"]),
  status: z.enum(["published", "draft"]),
  details: z.record(z.string(), z.unknown())
}).refine((data) => data.options.some((option) => option.label === data.answer), { message: "参考答案没有对应选项" });

const createImportSchema = z.object({
  categoryId: z.number().int().positive(),
  mode: importModeSchema,
  label: z.string().trim().max(200).default("Word 批量导入"),
  totalCount: z.number().int().positive().max(10000)
});

app.post("/api/admin/imports", zValidator("json", createImportSchema), async (c) => {
  const data = c.req.valid("json");
  const category = await c.env.DB.prepare("SELECT id FROM categories WHERE id = ?").bind(data.categoryId).first();
  if (!category) return c.json({ error: "导入分类不存在" }, 404);
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM question_import_items WHERE import_id IN (SELECT id FROM question_imports WHERE status = 'uploading' AND created_at < datetime('now', '-1 day'))"),
    c.env.DB.prepare("DELETE FROM question_imports WHERE status = 'uploading' AND created_at < datetime('now', '-1 day')"),
    c.env.DB.prepare(`INSERT INTO question_imports (id, category_id, mode, label, total_count) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, data.categoryId, data.mode, data.label, data.totalCount)
  ]);
  return c.json({ id, receivedCount: 0 }, 201);
});

const importBatchSchema = z.object({ questions: z.array(importQuestionSchema).min(1).max(25) });

app.put("/api/admin/imports/:id/items", zValidator("json", importBatchSchema), async (c) => {
  const importId = c.req.param("id");
  const session = await c.env.DB.prepare("SELECT status, total_count AS totalCount FROM question_imports WHERE id = ?")
    .bind(importId).first<{ status: string; totalCount: number }>();
  if (!session) return c.json({ error: "导入任务不存在" }, 404);
  if (session.status !== "uploading") return c.json({ error: "导入任务已结束" }, 409);
  const questions = c.req.valid("json").questions;
  await c.env.DB.batch(questions.map((question) => c.env.DB.prepare(`
    INSERT INTO question_import_items (
      import_id, position, import_key, type, stem, options_json, answer, explanation, source, difficulty, status, details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(import_id, position) DO UPDATE SET
      import_key = excluded.import_key, type = excluded.type, stem = excluded.stem,
      options_json = excluded.options_json, answer = excluded.answer, explanation = excluded.explanation,
      source = excluded.source, difficulty = excluded.difficulty, status = excluded.status, details_json = excluded.details_json
  `).bind(
    importId, question.position, question.importKey, question.type, question.stem, JSON.stringify(question.options),
    question.answer, question.explanation, question.source, question.difficulty, question.status, JSON.stringify(question.details)
  )));
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM question_import_items WHERE import_id = ?")
    .bind(importId).first<{ count: number }>();
  await c.env.DB.prepare("UPDATE question_imports SET received_count = ? WHERE id = ?").bind(count?.count ?? 0, importId).run();
  return c.json({ ok: true, receivedCount: count?.count ?? 0, totalCount: session.totalCount });
});

app.post("/api/admin/imports/:id/finalize", async (c) => {
  const importId = c.req.param("id");
  const session = await c.env.DB.prepare(`
    SELECT id, category_id AS categoryId, mode, status, total_count AS totalCount,
      (SELECT COUNT(*) FROM question_import_items WHERE import_id = question_imports.id) AS receivedCount
    FROM question_imports WHERE id = ?
  `).bind(importId).first<{ id: string; categoryId: number; mode: "append" | "replace"; status: string; totalCount: number; receivedCount: number }>();
  if (!session) return c.json({ error: "导入任务不存在" }, 404);
  if (session.status !== "uploading") return c.json({ error: "导入任务已结束" }, 409);
  if (session.receivedCount !== session.totalCount) return c.json({ error: `仅收到 ${session.receivedCount}/${session.totalCount} 道题，请继续上传` }, 409);

  const statements: D1PreparedStatement[] = [];
  if (session.mode === "replace") {
    statements.push(c.env.DB.prepare("DELETE FROM questions WHERE category_id = ?").bind(session.categoryId));
  } else {
    statements.push(c.env.DB.prepare(`
      UPDATE questions SET import_key = (
        SELECT i.import_key FROM question_import_items i
        WHERE i.import_id = ? AND i.stem = questions.stem AND i.options_json = questions.options_json LIMIT 1
      )
      WHERE category_id = ? AND import_key IS NULL AND EXISTS (
        SELECT 1 FROM question_import_items i
        WHERE i.import_id = ? AND i.stem = questions.stem AND i.options_json = questions.options_json
      )
    `).bind(importId, session.categoryId, importId));
  }
  statements.push(c.env.DB.prepare(`
    INSERT INTO questions (
      category_id, type, stem, options_json, answer, explanation, source, difficulty, status, details_json, import_key
    )
    SELECT ?, type, stem, options_json, answer, explanation, source, difficulty, status, details_json, import_key
    FROM question_import_items WHERE import_id = ?
    ON CONFLICT(import_key) DO UPDATE SET
      category_id = excluded.category_id, type = excluded.type, stem = excluded.stem,
      options_json = excluded.options_json, answer = excluded.answer, explanation = excluded.explanation,
      source = excluded.source, difficulty = excluded.difficulty, status = excluded.status,
      details_json = excluded.details_json, updated_at = CURRENT_TIMESTAMP
  `).bind(session.categoryId, importId));
  statements.push(c.env.DB.prepare("UPDATE question_imports SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").bind(importId));
  statements.push(c.env.DB.prepare("DELETE FROM question_import_items WHERE import_id = ?").bind(importId));
  await c.env.DB.batch(statements);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM questions WHERE category_id = ?").bind(session.categoryId).first<{ count: number }>();
  return c.json({ ok: true, importedCount: session.totalCount, categoryQuestionCount: count?.count ?? 0 });
});

app.delete("/api/admin/imports/:id", async (c) => {
  const importId = c.req.param("id");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM question_import_items WHERE import_id = ?").bind(importId),
    c.env.DB.prepare("UPDATE question_imports SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'uploading'").bind(importId)
  ]);
  return c.json({ ok: true });
});

app.post("/api/admin/questions", zValidator("json", questionSchema), async (c) => {
  const data = c.req.valid("json");
  const result = await c.env.DB.prepare(`
    INSERT INTO questions (category_id, type, stem, options_json, answer, explanation, source, difficulty, status, image_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(data.categoryId, data.type, data.stem, JSON.stringify(data.options), data.answer, data.explanation, data.source, data.difficulty, data.status, data.imageKey || null).run();
  return c.json({ ok: true, id: result.meta.last_row_id }, 201);
});

app.put("/api/admin/questions/:id", zValidator("json", questionSchema), async (c) => {
  const data = c.req.valid("json");
  const id = Number(c.req.param("id"));
  const old = await c.env.DB.prepare("SELECT image_key FROM questions WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  await c.env.DB.prepare(`
    UPDATE questions SET category_id = ?, type = ?, stem = ?, options_json = ?, answer = ?, explanation = ?,
      source = ?, difficulty = ?, status = ?, image_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).bind(data.categoryId, data.type, data.stem, JSON.stringify(data.options), data.answer, data.explanation, data.source, data.difficulty, data.status, data.imageKey || null, id).run();
  if (old?.image_key && old.image_key !== data.imageKey) await c.env.MEDIA.delete(old.image_key);
  return c.json({ ok: true });
});

app.delete("/api/admin/questions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const old = await c.env.DB.prepare("SELECT image_key FROM questions WHERE id = ?").bind(id).first<{ image_key: string | null }>();
  await c.env.DB.prepare("DELETE FROM questions WHERE id = ?").bind(id).run();
  if (old?.image_key) await c.env.MEDIA.delete(old.image_key);
  return c.json({ ok: true });
});

app.post("/api/admin/media", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "请选择图片" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "只支持图片文件" }, 400);
  if (file.size > 5 * 1024 * 1024) return c.json({ error: "图片不能超过5MB" }, 400);
  const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "webp";
  const key = `question-${crypto.randomUUID()}.${extension}`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return c.json({ key, url: `/api/media/${key}` }, 201);
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
  score: z.number().min(0).max(100),
  questionSnapshots: z.array(z.record(z.string(), z.unknown())).max(100).optional()
});

app.post("/api/attempts", zValidator("json", attemptSchema), async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);
  const attempt = c.req.valid("json");
  await c.env.DB.prepare(`
    INSERT INTO attempts (id, user_key, user_id, title, score, correct_count, wrong_count, unanswered_count,
      question_count, duration_seconds, started_at, submitted_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json
  `).bind(
    attempt.id, `user:${user.id}`, user.id, attempt.title, attempt.score, attempt.correctCount, attempt.wrongCount,
    attempt.unansweredCount, attempt.questionIds.length, attempt.durationSeconds,
    attempt.startedAt, attempt.submittedAt, JSON.stringify(attempt)
  ).run();
  return c.json({ ok: true }, 201);
});

app.get("/api/attempts", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "请先登录" }, 401);
  const { results } = await c.env.DB.prepare(`
    SELECT payload_json FROM attempts WHERE user_id = ? ORDER BY submitted_at DESC LIMIT 100
  `).bind(user.id).all<{ payload_json: string }>();
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
