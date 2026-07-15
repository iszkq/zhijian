ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE questions ADD COLUMN image_key TEXT;

CREATE INDEX IF NOT EXISTS idx_users_role_status ON users(role, status);
