package store

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
		readMigrationFile(t, "010_project_task_type_totals.sql"),
		readMigrationFile(t, "011_project_overview_markdown.sql"),
		readMigrationFile(t, "012_model_run_session_list.sql"),
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
	assertColumnExists(t, store.DB, "model_runs", "session_list")
	assertColumnExists(t, store.DB, "projects", "default_submit_repo")
	assertColumnExists(t, store.DB, "projects", "task_types")
	assertColumnExists(t, store.DB, "projects", "task_type_totals")
	assertColumnExists(t, store.DB, "projects", "overview_markdown")
	assertTableCount(t, store.DB, "schema_migrations", 12)

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
	if project.OverviewMarkdown != "" {
		t.Fatalf("unexpected overview markdown: %q", project.OverviewMarkdown)
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
	assertTableCount(t, reopened.DB, "schema_migrations", 12)
	assertRepairCountAtLeast(t, reopened.DB, 1)
}

func TestOpenRejectsMigrationChecksumMismatch(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "pinru.db")
	migrations := []string{
		readMigrationFile(t, "001_init.sql"),
		readMigrationFile(t, "002_model_runs_extend.sql"),
	}

	store, err := Open(dbPath, migrations...)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	store.Close()

	_, err = Open(dbPath,
		migrations[0],
		migrations[1]+"\n-- changed",
	)
	if err == nil {
		t.Fatalf("expected checksum mismatch error")
	}
	if !strings.Contains(err.Error(), "migration checksum mismatch") {
		t.Fatalf("unexpected error = %v", err)
	}
}

func TestSplitSQLStatementsHandlesQuotedSemicolonsAndComments(t *testing.T) {
	sqlText := strings.Join([]string{
		"-- leading comment should be ignored",
		"CREATE TABLE demo (content TEXT DEFAULT 'a;b');",
		"/* block comment; with semicolon */",
		"INSERT INTO demo (content) VALUES ('x;y');",
		`INSERT INTO demo (content) VALUES ("quoted;value");`,
		"",
	}, "\n")

	got := splitSQLStatements(sqlText)
	if len(got) != 3 {
		t.Fatalf("splitSQLStatements() len = %d, want 3 (%v)", len(got), got)
	}
	if got[0] != "CREATE TABLE demo (content TEXT DEFAULT 'a;b')" {
		t.Fatalf("first statement = %q", got[0])
	}
	if got[1] != "INSERT INTO demo (content) VALUES ('x;y')" {
		t.Fatalf("second statement = %q", got[1])
	}
	if got[2] != `INSERT INTO demo (content) VALUES ("quoted;value")` {
		t.Fatalf("third statement = %q", got[2])
	}
}

func TestCreateTaskDefaultsToUncategorizedType(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-default-type",
		GitLabProjectID: 2048,
		ProjectName:     "Default Type Demo",
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	created, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if created == nil {
		t.Fatalf("expected created task")
	}
	if created.TaskType != defaultTaskType {
		t.Fatalf("TaskType = %q, want %q", created.TaskType, defaultTaskType)
	}
	if len(created.SessionList) != 1 {
		t.Fatalf("SessionList length = %d, want 1", len(created.SessionList))
	}
	if created.SessionList[0].TaskType != defaultTaskType {
		t.Fatalf("SessionList[0].TaskType = %q, want %q", created.SessionList[0].TaskType, defaultTaskType)
	}
	if !created.SessionList[0].ConsumeQuota {
		t.Fatalf("expected default session to consume quota")
	}
}

func TestCreateTaskWithModelRunsRollsBackOnDuplicateModelName(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-rollback",
		GitLabProjectID: 2001,
		ProjectName:     "Demo",
		TaskType:        "Bug修复",
	}
	runs := []ModelRun{
		{ID: "run-1", TaskID: task.ID, ModelName: "ORIGIN"},
		{ID: "run-2", TaskID: task.ID, ModelName: "ORIGIN"},
	}

	if err := store.CreateTaskWithModelRuns(task, runs); err == nil {
		t.Fatalf("expected CreateTaskWithModelRuns() to fail on duplicate model names")
	}

	savedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask != nil {
		t.Fatalf("expected task insert to rollback, got %+v", savedTask)
	}

	savedRuns, err := store.ListModelRuns(task.ID)
	if err != nil {
		t.Fatalf("ListModelRuns() error = %v", err)
	}
	if len(savedRuns) != 0 {
		t.Fatalf("expected model runs insert to rollback, got %d rows", len(savedRuns))
	}
}

func TestModelRunsRequireUniqueTaskAndModel(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	task := Task{
		ID:              "task-unique",
		GitLabProjectID: 2002,
		ProjectName:     "Demo",
		TaskType:        "Bug修复",
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	firstRun := ModelRun{ID: "run-a", TaskID: task.ID, ModelName: "ORIGIN"}
	if err := store.CreateModelRun(firstRun); err != nil {
		t.Fatalf("CreateModelRun(firstRun) error = %v", err)
	}

	duplicateRun := ModelRun{ID: "run-b", TaskID: task.ID, ModelName: "ORIGIN"}
	if err := store.CreateModelRun(duplicateRun); err == nil {
		t.Fatalf("expected duplicate model run insert to fail")
	}
}

func TestConsumeProjectQuotaAllowsOverdraft(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-overdraft-claim",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      `["Feature迭代"]`,
		TaskTypeQuotas: `{"Feature迭代":0}`,
		TaskTypeTotals: `{"Feature迭代":3}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	if err := store.ConsumeProjectQuota(project.ID, "Feature迭代"); err != nil {
		t.Fatalf("ConsumeProjectQuota() error = %v", err)
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
	if gotQuotas["Feature迭代"] != -1 {
		t.Fatalf("TaskTypeQuotas[%q] = %d, want -1", "Feature迭代", gotQuotas["Feature迭代"])
	}
}

func TestUpdateTaskTypeAllowsOverdraft(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-task-type-overdraft",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      `["Feature迭代","Bug修复"]`,
		TaskTypeQuotas: `{"Feature迭代":0,"Bug修复":0}`,
		TaskTypeTotals: `{"Feature迭代":1,"Bug修复":15}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	task := Task{
		ID:              "task-type-overdraft",
		GitLabProjectID: 1004,
		ProjectName:     "Task Type Overdraft",
		TaskType:        "Feature迭代",
		ProjectConfigID: &project.ID,
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := store.UpdateTaskType(task.ID, "Bug修复"); err != nil {
		t.Fatalf("UpdateTaskType() error = %v", err)
	}

	updatedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if updatedTask == nil {
		t.Fatalf("expected updated task")
	}
	if updatedTask.TaskType != "Bug修复" {
		t.Fatalf("TaskType = %q, want %q", updatedTask.TaskType, "Bug修复")
	}
	if len(updatedTask.SessionList) == 0 || updatedTask.SessionList[0].TaskType != "Bug修复" {
		t.Fatalf("SessionList[0].TaskType = %+v, want %q", updatedTask.SessionList, "Bug修复")
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
	if gotQuotas["Feature迭代"] != 1 {
		t.Fatalf("TaskTypeQuotas[%q] = %d, want 1", "Feature迭代", gotQuotas["Feature迭代"])
	}
	if gotQuotas["Bug修复"] != -1 {
		t.Fatalf("TaskTypeQuotas[%q] = %d, want -1", "Bug修复", gotQuotas["Bug修复"])
	}
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
		TaskTypeTotals: `{"Feature迭代":2,"Bug修复":1,"代码生成":3}`,
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
	var gotTotals map[string]int
	if err := json.Unmarshal([]byte(updatedProject.TaskTypeTotals), &gotTotals); err != nil {
		t.Fatalf("json.Unmarshal(TaskTypeTotals) error = %v", err)
	}
	wantTotals := map[string]int{
		"Feature迭代": 2,
		"Bug修复":     1,
		"代码生成":      3,
	}
	for taskType, want := range wantTotals {
		if gotTotals[taskType] != want {
			t.Fatalf("TaskTypeTotals[%q] = %d, want %d", taskType, gotTotals[taskType], want)
		}
	}
}

func TestUpdateModelRunSessionListIsScopedPerModel(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-model-sessions",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,model-a,model-b",
		TaskTypes:      `["Feature迭代","Bug修复","代码生成"]`,
		TaskTypeQuotas: `{"Feature迭代":10,"Bug修复":10,"代码生成":10}`,
		TaskTypeTotals: `{"Feature迭代":10,"Bug修复":10,"代码生成":10}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	task := Task{
		ID:              "task-model-sessions",
		GitLabProjectID: 1002,
		ProjectName:     "Demo Task",
		TaskType:        "Feature迭代",
		ProjectConfigID: &project.ID,
	}
	modelRuns := []ModelRun{
		{ID: "run-model-a", TaskID: task.ID, ModelName: "model-a"},
		{ID: "run-model-b", TaskID: task.ID, ModelName: "model-b"},
	}
	if err := store.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}

	modelASessions := []TaskSession{
		{
			SessionID:    "sess-a-1",
			TaskType:     "Feature迭代",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(true),
			Evaluation:   "A 第一轮",
		},
		{
			SessionID:    "sess-a-2",
			TaskType:     "Bug修复",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(false),
			IsSatisfied:  boolPtr(false),
			Evaluation:   "A 第二轮",
		},
	}
	if err := store.UpdateModelRunSessionList(task.ID, "run-model-a", modelASessions); err != nil {
		t.Fatalf("UpdateModelRunSessionList(model-a) error = %v", err)
	}

	modelBSessions := []TaskSession{
		{
			SessionID:    "sess-b-1",
			TaskType:     "代码生成",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(false),
			Evaluation:   "B 第一轮",
		},
	}
	if err := store.UpdateModelRunSessionList(task.ID, "run-model-b", modelBSessions); err != nil {
		t.Fatalf("UpdateModelRunSessionList(model-b) error = %v", err)
	}

	runA, err := store.GetModelRun(task.ID, "model-a")
	if err != nil {
		t.Fatalf("GetModelRun(model-a) error = %v", err)
	}
	if runA == nil {
		t.Fatalf("expected model-a run")
	}
	if len(runA.SessionList) != 2 {
		t.Fatalf("model-a session list len = %d, want 2", len(runA.SessionList))
	}
	if runA.SessionList[0].SessionID != "sess-a-1" || runA.SessionList[1].SessionID != "sess-a-2" {
		t.Fatalf("unexpected model-a session IDs: %+v", runA.SessionList)
	}

	runB, err := store.GetModelRun(task.ID, "model-b")
	if err != nil {
		t.Fatalf("GetModelRun(model-b) error = %v", err)
	}
	if runB == nil {
		t.Fatalf("expected model-b run")
	}
	if len(runB.SessionList) != 1 {
		t.Fatalf("model-b session list len = %d, want 1", len(runB.SessionList))
	}
	if runB.SessionList[0].SessionID != "sess-b-1" {
		t.Fatalf("model-b first session = %q, want sess-b-1", runB.SessionList[0].SessionID)
	}

	reloadedRunA, err := store.GetModelRun(task.ID, "model-a")
	if err != nil {
		t.Fatalf("GetModelRun(model-a) reload error = %v", err)
	}
	if reloadedRunA == nil {
		t.Fatalf("expected reloaded model-a run")
	}
	if len(reloadedRunA.SessionList) != 2 {
		t.Fatalf("reloaded model-a session list len = %d, want 2", len(reloadedRunA.SessionList))
	}
}

func TestCreateProjectNormalizesTaskTypePayload(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-normalized",
		Name:           "Normalized Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      "Feature迭代\nBug修复\nFeature迭代",
		TaskTypeQuotas: `{"Feature迭代":2,"代码测试":1}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	updatedProject, err := store.GetProject(project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if updatedProject == nil {
		t.Fatalf("expected normalized project")
	}

	gotTaskTypes, err := parseTaskTypeList(updatedProject.TaskTypes)
	if err != nil {
		t.Fatalf("parseTaskTypeList(TaskTypes) error = %v", err)
	}
	wantTaskTypes := []string{"Feature迭代", "Bug修复", "代码测试"}
	if len(gotTaskTypes) != len(wantTaskTypes) {
		t.Fatalf("TaskTypes length = %d, want %d", len(gotTaskTypes), len(wantTaskTypes))
	}
	for index, want := range wantTaskTypes {
		if gotTaskTypes[index] != want {
			t.Fatalf("TaskTypes[%d] = %q, want %q", index, gotTaskTypes[index], want)
		}
	}

	gotQuotas, err := parseTaskTypeCountMap(updatedProject.TaskTypeQuotas)
	if err != nil {
		t.Fatalf("parseTaskTypeCountMap(TaskTypeQuotas) error = %v", err)
	}
	gotTotals, err := parseTaskTypeCountMap(updatedProject.TaskTypeTotals)
	if err != nil {
		t.Fatalf("parseTaskTypeCountMap(TaskTypeTotals) error = %v", err)
	}

	wantCounts := map[string]int{
		"Feature迭代": 2,
		"代码测试":      1,
	}
	if len(gotQuotas) != len(wantCounts) {
		t.Fatalf("TaskTypeQuotas length = %d, want %d", len(gotQuotas), len(wantCounts))
	}
	if len(gotTotals) != len(wantCounts) {
		t.Fatalf("TaskTypeTotals length = %d, want %d", len(gotTotals), len(wantCounts))
	}
	for taskType, want := range wantCounts {
		if gotQuotas[taskType] != want {
			t.Fatalf("TaskTypeQuotas[%q] = %d, want %d", taskType, gotQuotas[taskType], want)
		}
		if gotTotals[taskType] != want {
			t.Fatalf("TaskTypeTotals[%q] = %d, want %d", taskType, gotTotals[taskType], want)
		}
	}
}

func TestCreateAndUpdateProjectPersistOverviewMarkdown(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:               "proj-overview",
		Name:             "Overview Demo",
		GitLabURL:        "https://gitlab.example.com",
		GitLabToken:      "glpat-test",
		CloneBasePath:    "/tmp/demo",
		Models:           "ORIGIN,cotv21-pro",
		TaskTypes:        `["Bug修复"]`,
		TaskTypeQuotas:   `{"Bug修复":2}`,
		TaskTypeTotals:   `{"Bug修复":2}`,
		OverviewMarkdown: "# 项目记录\r\n\r\n- 第一轮\r\n- 第二轮",
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	savedProject, err := store.GetProject(project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if savedProject == nil {
		t.Fatalf("expected saved project")
	}
	wantInitial := "# 项目记录\n\n- 第一轮\n- 第二轮"
	if savedProject.OverviewMarkdown != wantInitial {
		t.Fatalf("OverviewMarkdown = %q, want %q", savedProject.OverviewMarkdown, wantInitial)
	}

	project.OverviewMarkdown = "## 更新\n\n`已完成`"
	if err := store.UpdateProject(project); err != nil {
		t.Fatalf("UpdateProject() error = %v", err)
	}

	updatedProject, err := store.GetProject(project.ID)
	if err != nil {
		t.Fatalf("GetProject() error = %v", err)
	}
	if updatedProject == nil {
		t.Fatalf("expected updated project")
	}
	if updatedProject.OverviewMarkdown != project.OverviewMarkdown {
		t.Fatalf("OverviewMarkdown after update = %q, want %q", updatedProject.OverviewMarkdown, project.OverviewMarkdown)
	}
}

func TestCreateProjectRejectsInvalidTaskTypePayload(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-invalid-task-types",
		Name:           "Invalid Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN",
		TaskTypes:      `["Feature迭代",`,
		TaskTypeQuotas: `{"Feature迭代":2}`,
	}
	err := store.CreateProject(project)
	if err == nil {
		t.Fatalf("expected CreateProject() to reject invalid task type payload")
	}
	if !strings.Contains(err.Error(), "invalid task type JSON") {
		t.Fatalf("CreateProject() error = %v, want invalid task type JSON", err)
	}
}

func TestUpdateTaskSessionListAllowsQuotaOverdraft(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-overdraft",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      `["Feature迭代","Bug修复"]`,
		TaskTypeQuotas: `{"Feature迭代":1,"Bug修复":0}`,
		TaskTypeTotals: `{"Feature迭代":1,"Bug修复":0}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	task := Task{
		ID:              "task-overdraft",
		GitLabProjectID: 1002,
		ProjectName:     "Overdraft Task",
		TaskType:        "Feature迭代",
		ProjectConfigID: &project.ID,
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := store.ConsumeProjectQuota(project.ID, "Feature迭代"); err != nil {
		t.Fatalf("ConsumeProjectQuota() error = %v", err)
	}

	if err := store.UpdateTaskSessionList("task-overdraft", []TaskSession{
		{
			SessionID:    "sess-main",
			TaskType:     "Feature迭代",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(true),
			Evaluation:   "主流程已完成",
		},
		{
			SessionID:    "sess-bug",
			TaskType:     "Bug修复",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(false),
			Evaluation:   "补充记录一个 bug 轮次",
		},
	}); err != nil {
		t.Fatalf("UpdateTaskSessionList() error = %v", err)
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
	if gotQuotas["Feature迭代"] != 0 {
		t.Fatalf("TaskTypeQuotas[%q] = %d, want 0", "Feature迭代", gotQuotas["Feature迭代"])
	}
	if gotQuotas["Bug修复"] != -1 {
		t.Fatalf("TaskTypeQuotas[%q] = %d, want -1", "Bug修复", gotQuotas["Bug修复"])
	}
	if updatedProject.TaskTypeTotals != `{"Bug修复":0,"Feature迭代":1}` && updatedProject.TaskTypeTotals != `{"Feature迭代":1,"Bug修复":0}` {
		t.Fatalf("TaskTypeTotals should remain fixed, got %s", updatedProject.TaskTypeTotals)
	}
}

func TestUpdateProjectRecomputesRemainingQuotaFromFixedTotals(t *testing.T) {
	store := openTestStore(t)
	defer store.Close()

	project := Project{
		ID:             "proj-update",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-test",
		CloneBasePath:  "/tmp/demo",
		Models:         "ORIGIN,cotv21-pro",
		TaskTypes:      `["Feature迭代","Bug修复"]`,
		TaskTypeQuotas: `{"Feature迭代":1,"Bug修复":2}`,
		TaskTypeTotals: `{"Feature迭代":3,"Bug修复":2}`,
	}
	if err := store.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	task := Task{
		ID:              "task-update",
		GitLabProjectID: 1003,
		ProjectName:     "Quota Task",
		TaskType:        "Feature迭代",
		ProjectConfigID: &project.ID,
	}
	if err := store.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := store.ConsumeProjectQuota(project.ID, "Feature迭代"); err != nil {
		t.Fatalf("ConsumeProjectQuota() error = %v", err)
	}
	if err := store.UpdateTaskSessionList("task-update", []TaskSession{
		{
			SessionID:    "sess-main",
			TaskType:     "Feature迭代",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(true),
		},
		{
			SessionID:    "sess-bug",
			TaskType:     "Bug修复",
			ConsumeQuota: true,
			IsCompleted:  boolPtr(true),
			IsSatisfied:  boolPtr(false),
		},
	}); err != nil {
		t.Fatalf("UpdateTaskSessionList() error = %v", err)
	}

	project.TaskTypeTotals = `{"Feature迭代":5,"Bug修复":4}`
	project.TaskTypeQuotas = `{"Feature迭代":999,"Bug修复":999}`
	if err := store.UpdateProject(project); err != nil {
		t.Fatalf("UpdateProject() error = %v", err)
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
	if gotQuotas["Feature迭代"] != 4 {
		t.Fatalf("TaskTypeQuotas[Feature迭代] = %d, want 4", gotQuotas["Feature迭代"])
	}
	if gotQuotas["Bug修复"] != 3 {
		t.Fatalf("TaskTypeQuotas[Bug修复] = %d, want 3", gotQuotas["Bug修复"])
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
		readMigrationFile(t, "010_project_task_type_totals.sql"),
		readMigrationFile(t, "011_project_overview_markdown.sql"),
		readMigrationFile(t, "012_model_run_session_list.sql"),
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

func assertRepairCountAtLeast(t *testing.T, db *sql.DB, minimum int) {
	t.Helper()

	var got int
	if err := db.QueryRow("SELECT COUNT(*) FROM schema_repairs").Scan(&got); err != nil {
		t.Fatalf("count schema_repairs error = %v", err)
	}
	if got < minimum {
		t.Fatalf("schema_repairs count = %d, want >= %d", got, minimum)
	}
}
