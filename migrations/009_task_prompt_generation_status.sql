-- Add prompt generation background state to tasks
ALTER TABLE tasks ADD COLUMN prompt_generation_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE tasks ADD COLUMN prompt_generation_error TEXT;
ALTER TABLE tasks ADD COLUMN prompt_generation_started_at INTEGER;
ALTER TABLE tasks ADD COLUMN prompt_generation_finished_at INTEGER;
