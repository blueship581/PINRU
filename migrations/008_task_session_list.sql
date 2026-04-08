-- Add session_list column to tasks table (JSON array of task sessions)
ALTER TABLE tasks ADD COLUMN session_list TEXT NOT NULL DEFAULT '[]';
