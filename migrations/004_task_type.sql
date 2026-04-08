-- Add task_type column to tasks table
ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'Feature迭代';
