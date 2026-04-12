ALTER TABLE model_runs ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE model_runs ADD COLUMN review_round INTEGER NOT NULL DEFAULT 0;
ALTER TABLE model_runs ADD COLUMN review_notes TEXT;
