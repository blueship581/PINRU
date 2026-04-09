-- Add task_type_totals column to projects table (JSON: {"Bug修复":15,"代码生成":8,...})
ALTER TABLE projects ADD COLUMN task_type_totals TEXT NOT NULL DEFAULT '{}';
