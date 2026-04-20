ALTER TABLE projects ADD COLUMN question_bank_project_ids TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS question_bank_items (
    project_config_id TEXT NOT NULL,
    question_id INTEGER NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    source_kind TEXT NOT NULL DEFAULT '',
    source_path TEXT NOT NULL DEFAULT '',
    archive_path TEXT,
    origin_ref TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ready',
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (project_config_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_question_bank_items_project_updated
    ON question_bank_items(project_config_id, updated_at DESC);
