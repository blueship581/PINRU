ALTER TABLE model_runs ADD COLUMN session_id TEXT;
ALTER TABLE model_runs ADD COLUMN conversation_rounds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_runs ADD COLUMN conversation_date INTEGER;
