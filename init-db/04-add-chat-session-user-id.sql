-- Add user_id column to chat_sessions for future multi-user support
ALTER TABLE chat_sessions
ADD COLUMN IF NOT EXISTS user_id VARCHAR(128);

