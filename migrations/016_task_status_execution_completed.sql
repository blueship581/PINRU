-- Add 'ExecutionCompleted' to the tasks.status CHECK constraint.
-- SQLite does not support ALTER CHECK, so we recreate the table.

PRAGMA foreign_keys = OFF;

CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY,
    gitlab_project_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Claimed' CHECK(status IN ('Claimed','Downloading','Downloaded','PromptReady','ExecutionCompleted','Submitted','Error')),
    local_path TEXT,
    prompt_text TEXT,
    notes TEXT,
    project_config_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    task_type TEXT NOT NULL DEFAULT '未归类',
    session_list TEXT NOT NULL DEFAULT '[]',
    prompt_generation_status TEXT NOT NULL DEFAULT 'idle',
    prompt_generation_error TEXT,
    prompt_generation_started_at INTEGER,
    prompt_generation_finished_at INTEGER
);

INSERT INTO tasks_new SELECT * FROM tasks;

DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX IF NOT EXISTS idx_tasks_project_config ON tasks(project_config_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

PRAGMA foreign_keys = ON;
