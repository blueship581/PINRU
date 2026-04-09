package store

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestOpenMigratesLegacyConfigsIntoNewTables(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	seedLegacyDatabase(t, dbPath)

	migrations := []string{
		readMigrationFile(t, "001_init.sql"),
		readMigrationFile(t, "002_model_runs_extend.sql"),
		readMigrationFile(t, "003_submit_results.sql"),
		readMigrationFile(t, "004_task_type.sql"),
		readMigrationFile(t, "005_project_task_quotas.sql"),
		readMigrationFile(t, "006_project_submit_defaults.sql"),
		readMigrationFile(t, "007_project_task_types.sql"),
		readMigrationFile(t, "008_task_session_list.sql"),
		readMigrationFile(t, "009_task_prompt_generation_status.sql"),
	}

	store, err := Open(dbPath, migrations...)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer store.Close()

	assertColumnExists(t, store.DB, "tasks", "task_type")
	assertColumnExists(t, store.DB, "tasks", "project_config_id")
	assertColumnExists(t, store.DB, "tasks", "session_list")
	assertColumnExists(t, store.DB, "tasks", "prompt_generation_status")
	assertColumnExists(t, store.DB, "tasks", "prompt_generation_error")
	assertColumnExists(t, store.DB, "projects", "default_submit_repo")
	assertColumnExists(t, store.DB, "projects", "task_types")

	tasks, err := store.ListTasks(nil)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("expected 1 legacy task, got %d", len(tasks))
	}
	if tasks[0].CreatedAt == 0 || tasks[0].UpdatedAt == 0 {
		t.Fatalf("expected migrated task timestamps to be converted to unix seconds")
	}
	if len(tasks[0].SessionList) != 1 {
		t.Fatalf("expected legacy task to be backfilled with a default session, got %d", len(tasks[0].SessionList))
	}
	if !tasks[0].SessionList[0].ConsumeQuota {
		t.Fatalf("expected default legacy task session to consume quota")
	}

	runs, err := store.ListModelRuns("task-1")
	if err != nil {
		t.Fatalf("ListModelRuns() error = %v", err)
	}
	if len(runs) != 1 {
		t.Fatalf("expected 1 legacy model run, got %d", len(runs))
	}
	if runs[0].StartedAt == nil || *runs[0].StartedAt == 0 {
		t.Fatalf("expected legacy model run startedAt to be converted to unix seconds")
	}

	project, err := store.GetProject("proj-1")
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if project == nil {
		t.Fatalf("expected migrated project")
	}
	if project.CloneBasePath != "/tmp/pinru/project" {
		t.Fatalf("unexpected clone path: %q", project.CloneBasePath)
	}
	if project.Models != "ORIGIN,cotv21-pro" {
		t.Fatalf("unexpected models: %q", project.Models)
	}
	if project.SourceModelFolder != "ORIGIN" {
		t.Fatalf("unexpected source model folder: %q", project.SourceModelFolder)
	}
	if project.DefaultSubmitRepo != "octo/demo-repo" {
		t.Fatalf("unexpected default submit repo: %q", project.DefaultSubmitRepo)
	}

	accounts, err := store.ListGitHubAccounts()
	if err != nil {
		t.Fatalf("ListGitHubAccounts() error = %v", err)
	}
	if len(accounts) != 1 {
		t.Fatalf("expected 1 migrated GitHub account, got %d", len(accounts))
	}
	if !accounts[0].IsDefault {
		t.Fatalf("expected migrated GitHub account to be default")
	}

	providers, err := store.ListLLMProviders()
	if err != nil {
		t.Fatalf("ListLLMProviders() error = %v", err)
	}
	if len(providers) != 1 {
		t.Fatalf("expected 1 migrated LLM provider, got %d", len(providers))
	}
	if providers[0].ProviderType != "openai_compatible" {
		t.Fatalf("unexpected provider type: %q", providers[0].ProviderType)
	}
	if !providers[0].IsDefault {
		t.Fatalf("expected migrated LLM provider to be default")
	}

	assertConfigEquals(t, store, legacyProjectsMigrationMarker, "done")
	assertConfigEquals(t, store, legacyGitHubMigrationMarker, "done")
	assertConfigEquals(t, store, legacyLLMProvidersMigrationMark, "done")
	assertConfigEquals(t, store, legacyProjectsConfigKey, "")
	assertConfigEquals(t, store, legacyGitHubAccountsConfigKey, "")
	assertConfigEquals(t, store, legacyLLMProvidersConfigKey, "")
	assertConfigEquals(t, store, "active_project_id", "proj-1")

	reopened, err := Open(dbPath, migrations...)
	if err != nil {
		t.Fatalf("reopen Open() error = %v", err)
	}
	defer reopened.Close()

	assertTableCount(t, reopened.DB, "projects", 1)
	assertTableCount(t, reopened.DB, "github_accounts", 1)
	assertTableCount(t, reopened.DB, "llm_providers", 1)
}

func TestUpdateTaskSessionListAdjustsProjectQuota(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-1",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      `["Feature迭代","Bug修复","代码生成"]`,
		TaskTypeQuotas: `{"Feature迭代":2,"Bug修复":1,"代码生成":3}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	task := Task{
		ID:              "task-1",
		GitLabProjectID: 1001,
		ProjectName:     "Demo Task",
		TaskType:        "Feature迭代",
		ProjectConfigID: &project.ID,
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := store.ConsumeProjectQuota(project.ID, "Feature迭代"); err != nil {
		t.Fatalf("ConsumeProjectQuota() error = %v", err)
	}

	if err := store.UpdateTaskSessionList("task-1", []TaskSession{
		{
			SessionID:    "sess-main",
			TaskType:     "Feature迭代",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(true),
			Evaluation:   "主流程已完成",
		},
		{
			SessionID:    "sess-extra",
			TaskType:     "Bug修复",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(false),
			IsSatisfied:  boolPtr(false),
			Evaluation:   "需要继续跟进",
		},
		{
			SessionID:    "sess-optional",
			TaskType:     "代码生成",
			ConsumeQuota: false,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(false),
			Evaluation:   "",
		},
	}); err != nil {
		t.Fatalf("UpdateTaskSessionList() error = %v", err)
	}

	updatedTask, err := store.GetTask("task-1")
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if updatedTask == nil {
		t.Fatalf("expected updated task")
	}
	if updatedTask.TaskType != "Feature迭代" {
		t.Fatalf("TaskType = %q, want %q", updatedTask.TaskType, "Feature迭代")
	}
	if len(updatedTask.SessionList) != 3 {
		t.Fatalf("SessionList length = %d, want 3", len(updatedTask.SessionList))
	}
	if !updatedTask.SessionList[0].ConsumeQuota {
		t.Fatalf("expected first session to be forced as quota-consuming")
	}
	if updatedTask.SessionList[0].IsCompleted == nil || !*updatedTask.SessionList[0].IsCompleted {
		t.Fatalf("expected first session completion flag to be persisted")
	}
	if updatedTask.SessionList[1].IsSatisfied == nil || *updatedTask.SessionList[1].IsSatisfied {
		t.Fatalf("expected second session satisfaction flag to be persisted")
	}
	if updatedTask.SessionList[1].Evaluation != "需要继续跟进" {
		t.Fatalf("unexpected second session evaluation: %q", updatedTask.SessionList[1].Evaluation)
	}

	updatedProject, err := store.GetProject(project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if updatedProject == nil {
		t.Fatalf("expected updated project")
	}
	var gotQuotas map[string]int
	if err := json.Unmarshal([]byte(updatedProject.TaskTypeQuotas), &gotQuotas); err != nil {
		t.Fatalf("json.Unmarshal(TaskTypeQuotas) error = %v", err)
	}
	wantQuotas := map[string]int{
		"Feature迭代": 1,
		"Bug修复":     0,
		"代码生成":      3,
	}
	if len(gotQuotas) != len(wantQuotas) {
		t.Fatalf("TaskTypeQuotas length = %d, want %d", len(gotQuotas), len(wantQuotas))
	}
	for taskType, want := range wantQuotas {
		if gotQuotas[taskType] != want {
			t.Fatalf("TaskTypeQuotas[%q] = %d, want %d", taskType, gotQuotas[taskType], want)
		}
	}
}

func TestUpdateTaskSessionListRequiresReviewFields(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-1",
		GitLabProjectID: 1001,
		ProjectName:     "Demo Task",
		TaskType:        "Feature迭代",
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	err := store.UpdateTaskSessionList("task-1", []TaskSession{
		{
			SessionID:    "sess-main",
			TaskType:     "Feature迭代",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  nil,
			Evaluation:   "缺少满意度",
		},
	})
	if err == nil {
		t.Fatalf("expected UpdateTaskSessionList() to reject missing review fields")
	}
	if err.Error() != "第 1 个 session 的是否满意不能为空" {
		t.Fatalf("unexpected error = %q", err.Error())
	}
}

func TestTaskPromptGenerationLifecycle(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-1",
		GitLabProjectID: 1001,
		ProjectName:     "Demo Task",
		TaskType:        "Feature迭代",
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	startedAt := int64(1712550000)
	if err := store.StartTaskPromptGeneration(task.ID, startedAt); err != nil {
		t.Fatalf("StartTaskPromptGeneration() error = %v", err)
	}

	runningTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() after start error = %v", err)
	}
	if runningTask == nil {
		t.Fatalf("expected task after start")
	}
	if runningTask.PromptGenerationStatus != "running" {
		t.Fatalf("PromptGenerationStatus after start = %q, want running", runningTask.PromptGenerationStatus)
	}
	if runningTask.PromptGenerationStartedAt == nil || *runningTask.PromptGenerationStartedAt != startedAt {
		t.Fatalf("PromptGenerationStartedAt after start = %v, want %d", runningTask.PromptGenerationStartedAt, startedAt)
	}

	if err := store.FailTaskPromptGeneration(task.ID, "boom", startedAt); err != nil {
		t.Fatalf("FailTaskPromptGeneration() error = %v", err)
	}
	failedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() after fail error = %v", err)
	}
	if failedTask == nil {
		t.Fatalf("expected task after fail")
	}
	if failedTask.PromptGenerationStatus != "error" {
		t.Fatalf("PromptGenerationStatus after fail = %q, want error", failedTask.PromptGenerationStatus)
	}
	if failedTask.PromptGenerationError == nil || *failedTask.PromptGenerationError != "boom" {
		t.Fatalf("PromptGenerationError after fail = %v, want boom", failedTask.PromptGenerationError)
	}

	if err := store.CompleteTaskPromptGeneration(task.ID, "final prompt", startedAt); err != nil {
		t.Fatalf("CompleteTaskPromptGeneration() error = %v", err)
	}
	completedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() after complete error = %v", err)
	}
	if completedTask == nil {
		t.Fatalf("expected task after complete")
	}
	if completedTask.Status != "PromptReady" {
		t.Fatalf("Status after complete = %q, want PromptReady", completedTask.Status)
	}
	if completedTask.PromptGenerationStatus != "done" {
		t.Fatalf("PromptGenerationStatus after complete = %q, want done", completedTask.PromptGenerationStatus)
	}
	if completedTask.PromptGenerationError != nil {
		t.Fatalf("PromptGenerationError after complete = %v, want nil", completedTask.PromptGenerationError)
	}
	if completedTask.PromptText == nil || *completedTask.PromptText != "final prompt" {
		t.Fatalf("PromptText after complete = %v, want final prompt", completedTask.PromptText)
	}
}

func TestSyncTaskPromptFromArtifactPreservesSubmittedStatus(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-submitted",
		GitLabProjectID: 2001,
		ProjectName:     "Submitted Demo",
		TaskType:        "Bug修复",
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := store.UpdateTaskStatus(task.ID, "Submitted"); err != nil {
		t.Fatalf("UpdateTaskStatus() error = %v", err)
	}

	if err := store.SyncTaskPromptFromArtifact(task.ID, "from artifact"); err != nil {
		t.Fatalf("SyncTaskPromptFromArtifact() error = %v", err)
	}

	savedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected task after sync")
	}
	if savedTask.Status != "Submitted" {
		t.Fatalf("Status after sync = %q, want Submitted", savedTask.Status)
	}
	if savedTask.PromptGenerationStatus != "done" {
		t.Fatalf("PromptGenerationStatus after sync = %q, want done", savedTask.PromptGenerationStatus)
	}
	if savedTask.PromptGenerationError != nil {
		t.Fatalf("PromptGenerationError after sync = %v, want nil", savedTask.PromptGenerationError)
	}
	if savedTask.PromptText == nil || *savedTask.PromptText != "from artifact" {
		t.Fatalf("PromptText after sync = %v, want from artifact", savedTask.PromptText)
	}
	if savedTask.PromptGenerationStartedAt == nil {
		t.Fatalf("expected PromptGenerationStartedAt to be set")
	}
	if savedTask.PromptGenerationFinishedAt == nil {
		t.Fatalf("expected PromptGenerationFinishedAt to be set")
	}
}

func openTestStore(t *testing.T) *Store {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	migrations := []string{
		readMigrationFile(t, "001_init.sql"),
		readMigrationFile(t, "002_model_runs_extend.sql"),
		readMigrationFile(t, "003_submit_results.sql"),
		readMigrationFile(t, "004_task_type.sql"),
		readMigrationFile(t, "005_project_task_quotas.sql"),
		readMigrationFile(t, "006_project_submit_defaults.sql"),
		readMigrationFile(t, "007_project_task_types.sql"),
		readMigrationFile(t, "008_task_session_list.sql"),
		readMigrationFile(t, "009_task_prompt_generation_status.sql"),
	}

	store, err := Open(dbPath, migrations...)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	return store
}

func boolPtr(value bool) *bool {
	return &value
}

func seedLegacyDatabase(t *testing.T, dbPath string) {
	t.Helper()

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	legacySchema := `
CREATE TABLE tasks (
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

CREATE TABLE model_runs (
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

CREATE TABLE configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`
	if _, err := db.Exec(legacySchema); err != nil {
		t.Fatalf("seed schema error = %v", err)
	}

	if _, err := db.Exec(
		`INSERT INTO tasks (id, gitlab_project_id, project_name, status, local_path, created_at, updated_at, notes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		"task-1",
		12345,
		"Legacy Task",
		"Claimed",
		"/tmp/pinru/project",
		"2026-04-01 09:30",
		"2026-04-01 09:35",
		"legacy note",
	); err != nil {
		t.Fatalf("seed legacy task error = %v", err)
	}

	if _, err := db.Exec(
		`INSERT INTO model_runs (id, task_id, model_name, local_path, status, started_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		"run-1",
		"task-1",
		"cotv21-pro",
		"/tmp/pinru/project/cotv21-pro",
		"done",
		"2026-04-01 09:40",
		"2026-04-01 09:45",
	); err != nil {
		t.Fatalf("seed legacy model run error = %v", err)
	}

	inserts := []struct {
		key   string
		value string
	}{
		{
			key: legacyProjectsConfigKey,
			value: `[{
				"id":"proj-1",
				"name":"Legacy Demo",
				"basePath":"/tmp/pinru/project",
				"models":["origin","cotv21-pro"],
				"sourceModelFolder":"origin"
			}]`,
		},
		{
			key: legacyGitHubAccountsConfigKey,
			value: `[{
				"id":"gh-1",
				"name":"Primary",
				"username":"octocat",
				"token":"ghp_test_123",
				"defaultRepo":"octo/demo-repo",
				"isDefault":true
			}]`,
		},
		{
			key: legacyLLMProvidersConfigKey,
			value: `[{
				"id":"llm-1",
				"name":"Legacy OpenAI",
				"providerType":"open_ai_compatible",
				"model":"gpt-4.1",
				"baseUrl":"https://api.openai.com/v1",
				"apiKey":"sk-test"
			}]`,
		},
		{key: "active_project_id", value: "proj-1"},
	}

	for _, insert := range inserts {
		if _, err := db.Exec("INSERT INTO configs (key, value) VALUES (?, ?)", insert.key, insert.value); err != nil {
			t.Fatalf("seed config %s error = %v", insert.key, err)
		}
	}
}

func readMigrationFile(t *testing.T, name string) string {
	t.Helper()

	path := filepath.Join("..", "..", "migrations", name)
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%s) error = %v", name, err)
	}
	return string(content)
}

func assertColumnExists(t *testing.T, db *sql.DB, table, column string) {
	t.Helper()

	rows, err := db.Query("PRAGMA table_info(" + table + ")")
	if err != nil {
		t.Fatalf("PRAGMA table_info(%s) error = %v", table, err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			cid        int
			name       string
			columnType string
			notNull    int
			defaultVal sql.NullString
			primaryKey int
		)
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultVal, &primaryKey); err != nil {
			t.Fatalf("Scan table_info(%s) error = %v", table, err)
		}
		if name == column {
			return
		}
	}

	if err := rows.Err(); err != nil {
		t.Fatalf("rows.Err() for %s = %v", table, err)
	}
	t.Fatalf("column %s.%s not found", table, column)
}

func assertConfigEquals(t *testing.T, store *Store, key, want string) {
	t.Helper()

	got, err := store.GetConfig(key)
	if err != nil {
		t.Fatalf("GetConfig(%s) error = %v", key, err)
	}
	if got != want {
		t.Fatalf("GetConfig(%s) = %q, want %q", key, got, want)
	}
}

func assertTableCount(t *testing.T, db *sql.DB, table string, want int) {
	t.Helper()

	var got int
	if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&got); err != nil {
		t.Fatalf("count %s error = %v", table, err)
	}
	if got != want {
		t.Fatalf("table %s count = %d, want %d", table, got, want)
	}
}
