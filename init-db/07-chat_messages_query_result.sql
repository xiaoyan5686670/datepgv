-- 会话历史：保存查询执行状态与结果摘要（供前端复盘表格）
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS executed BOOLEAN;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS exec_error TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS result_preview JSONB;
