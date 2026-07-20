ALTER TABLE questions ADD COLUMN import_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_import_key ON questions(import_key);

CREATE TABLE IF NOT EXISTS question_imports (
  id TEXT PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  mode TEXT NOT NULL CHECK(mode IN ('append', 'replace')),
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading', 'completed', 'cancelled')),
  total_count INTEGER NOT NULL,
  received_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS question_import_items (
  import_id TEXT NOT NULL REFERENCES question_imports(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  import_key TEXT NOT NULL,
  type TEXT NOT NULL,
  stem TEXT NOT NULL,
  options_json TEXT NOT NULL CHECK(json_valid(options_json)),
  answer TEXT NOT NULL,
  explanation TEXT NOT NULL,
  source TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK(difficulty IN ('基础', '进阶', '挑战')),
  status TEXT NOT NULL CHECK(status IN ('published', 'draft')),
  details_json TEXT NOT NULL CHECK(json_valid(details_json)),
  PRIMARY KEY (import_id, position)
);

CREATE INDEX IF NOT EXISTS idx_question_import_items_key ON question_import_items(import_id, import_key);
