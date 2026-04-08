-- configs: key-value store for global settings
CREATE TABLE IF NOT EXISTS configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- projects: project configuration profiles
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gitlab_url TEXT NOT NULL DEFAULT '',
    gitlab_token TEXT NOT NULL DEFAULT '',
    clone_base_path TEXT NOT NULL DEFAULT '',
    models TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- llm_providers: LLM API provider configurations
CREATE TABLE IF NOT EXISTS llm_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK(provider_type IN ('openai_compatible', 'anthropic')),
    model TEXT NOT NULL,
    base_url TEXT,
    api_key TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- github_accounts: GitHub credentials for PR submission
CREATE TABLE IF NOT EXISTS github_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- tasks: code review task records
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    gitlab_project_id INTEGER NOT NULL,
    project_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Claimed' CHECK(status IN ('Claimed','Downloading','Downloaded','PromptReady','Submitted','Error')),
    local_path TEXT,
    prompt_text TEXT,
    notes TEXT,
    project_config_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_config ON tasks(project_config_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

-- model_runs: per-model execution records within a task
CREATE TABLE IF NOT EXISTS model_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    branch_name TEXT,
    local_path TEXT,
    pr_url TEXT,
    origin_url TEXT,
    gsb_score TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','done','error')),
    started_at INTEGER,
    finished_at INTEGER,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_model_runs_task ON model_runs(task_id);

-- chat_sessions: conversation threads per task
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New Chat',
    model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_task ON chat_sessions(task_id);

-- chat_messages: individual turns in a session
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
