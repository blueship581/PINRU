CREATE TABLE IF NOT EXISTS ai_review_rounds (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL,
    model_run_id    TEXT,
    local_path      TEXT NOT NULL DEFAULT '',
    model_name      TEXT NOT NULL DEFAULT '',
    round_number    INTEGER NOT NULL DEFAULT 1,
    original_prompt TEXT NOT NULL DEFAULT '',
    prompt_text     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'none',
    is_completed    INTEGER,
    is_satisfied    INTEGER,
    review_notes    TEXT NOT NULL DEFAULT '',
    next_prompt     TEXT NOT NULL DEFAULT '',
    project_type    TEXT NOT NULL DEFAULT '',
    change_scope    TEXT NOT NULL DEFAULT '',
    key_locations   TEXT NOT NULL DEFAULT '',
    job_id          TEXT,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_review_rounds_task ON ai_review_rounds(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_rounds_model_run ON ai_review_rounds(model_run_id);
CREATE INDEX IF NOT EXISTS idx_ai_review_rounds_run_round ON ai_review_rounds(model_run_id, round_number);

-- Backfill from existing ai_review_nodes root nodes that were actually executed.
INSERT OR IGNORE INTO ai_review_rounds (
    id, task_id, model_run_id, local_path, model_name,
    round_number, original_prompt, prompt_text,
    status, is_completed, is_satisfied, review_notes, next_prompt,
    project_type, change_scope, key_locations, job_id,
    created_at, updated_at
)
SELECT
    id, task_id, model_run_id, local_path, model_name,
    CASE WHEN run_count > 0 THEN run_count ELSE 1 END,
    original_prompt, prompt_text,
    status, is_completed, is_satisfied, review_notes, next_prompt,
    project_type, change_scope, key_locations, last_job_id,
    created_at, updated_at
FROM ai_review_nodes
WHERE parent_id IS NULL
  AND is_active = 1
  AND run_count > 0;
