-- Bind chat sessions to owning user (fixes cross-user session visibility)
ALTER TABLE chat_sessions
    ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS chat_sessions_user_id_idx ON chat_sessions (user_id);
