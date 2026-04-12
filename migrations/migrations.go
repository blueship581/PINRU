package migrations

import _ "embed"

//go:embed 001_init.sql
var Migration001 string

//go:embed 002_model_runs_extend.sql
var Migration002 string

//go:embed 003_submit_results.sql
var Migration003 string

//go:embed 004_task_type.sql
var Migration004 string

//go:embed 005_project_task_quotas.sql
var Migration005 string

//go:embed 006_project_submit_defaults.sql
var Migration006 string

//go:embed 007_project_task_types.sql
var Migration007 string

//go:embed 008_task_session_list.sql
var Migration008 string

//go:embed 009_task_prompt_generation_status.sql
var Migration009 string

//go:embed 010_project_task_type_totals.sql
var Migration010 string

//go:embed 011_project_overview_markdown.sql
var Migration011 string

//go:embed 012_model_run_session_list.sql
var Migration012 string

//go:embed 013_background_jobs.sql
var Migration013 string

//go:embed 014_llm_provider_acp_types.sql
var Migration014 string

//go:embed 015_model_run_review.sql
var Migration015 string

// All returns all migration SQL strings in version order.
func All() []string {
	return []string{
		Migration001,
		Migration002,
		Migration003,
		Migration004,
		Migration005,
		Migration006,
		Migration007,
		Migration008,
		Migration009,
		Migration010,
		Migration011,
		Migration012,
		Migration013,
		Migration014,
		Migration015,
	}
}
