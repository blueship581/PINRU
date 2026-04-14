CREATE TABLE IF NOT EXISTS ai_review_nodes (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    model_run_id TEXT,
    parent_id TEXT,
    root_id TEXT NOT NULL,
    model_name TEXT NOT NULL DEFAULT '',
    local_path TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    issue_type TEXT NOT NULL DEFAULT 'Bug修复',
    level INTEGER NOT NULL DEFAULT 1,
    sequence INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'none',
    run_count INTEGER NOT NULL DEFAULT 0,
    original_prompt TEXT NOT NULL DEFAULT '',
    prompt_text TEXT NOT NULL DEFAULT '',
    review_notes TEXT NOT NULL DEFAULT '',
    parent_review_notes TEXT NOT NULL DEFAULT '',
    next_prompt TEXT NOT NULL DEFAULT '',
    is_completed INTEGER,
    is_satisfied INTEGER,
    project_type TEXT NOT NULL DEFAULT '',
    change_scope TEXT NOT NULL DEFAULT '',
    key_locations TEXT NOT NULL DEFAULT '',
    last_job_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_review_nodes_task ON ai_review_nodes(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_nodes_model_run ON ai_review_nodes(model_run_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_nodes_parent ON ai_review_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_nodes_root ON ai_review_nodes(root_id);
