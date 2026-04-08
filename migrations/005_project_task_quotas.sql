-- Add task_type_quotas column to projects table (JSON: {"Bug修复":5,"代码生成":3,...})
ALTER TABLE projects ADD COLUMN task_type_quotas TEXT NOT NULL DEFAULT '{}';
