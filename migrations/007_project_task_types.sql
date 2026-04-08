-- Add task_types column to projects table (JSON array: ["Bug修复","代码生成",...])
ALTER TABLE projects ADD COLUMN task_types TEXT NOT NULL DEFAULT '[]';
