-- tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    gitlab_project_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Claimed',
    local_path TEXT,
    prompt_text TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT
);

-- model_runs table
CREATE TABLE IF NOT EXISTS model_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    branch_name TEXT,
    local_path TEXT,
    pr_url TEXT,
    origin_url TEXT,
    gsb_score TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT,
    finished_at TEXT,
    FOREIGN KEY (task_id) REFERENCES tasks(id)
);

-- configs table
CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
