PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  soft_color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  type TEXT NOT NULL DEFAULT '单选题',
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK(json_valid(options_json)),
  answer TEXT NOT NULL,
  explanation TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '模拟题',
  difficulty TEXT NOT NULL DEFAULT '基础',
  status TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_category_status ON questions(category_id, status);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_key TEXT NOT NULL,
  title TEXT NOT NULL,
  score INTEGER NOT NULL,
  correct_count INTEGER NOT NULL,
  wrong_count INTEGER NOT NULL,
  unanswered_count INTEGER NOT NULL,
  question_count INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_submitted ON attempts(user_key, submitted_at DESC);

INSERT OR IGNORE INTO categories (id, slug, name, short_name, description, color, soft_color, sort_order) VALUES
  (1, 'politics', '政治理论', '政治', '马克思主义、党史与时政热点', '#6c5ce7', '#eeeafd', 1),
  (2, 'knowledge', '常识判断', '常识', '法律、科技、人文与地理常识', '#f59e42', '#fff3e5', 2),
  (3, 'language', '言语理解与表达', '言语', '选词填空、片段阅读与语句表达', '#21a179', '#e5f8f1', 3),
  (4, 'math', '数量关系', '数量', '数学运算与数字推理', '#ef5da8', '#fdebf4', 4),
  (5, 'data', '资料分析', '资料', '增长率、比重与综合分析', '#3b82f6', '#eaf2ff', 5);
