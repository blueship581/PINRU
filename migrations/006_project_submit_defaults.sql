-- Add source model / submit repo defaults to projects table
ALTER TABLE projects ADD COLUMN source_model_folder TEXT NOT NULL DEFAULT 'ORIGIN';
ALTER TABLE projects ADD COLUMN default_submit_repo TEXT NOT NULL DEFAULT '';
