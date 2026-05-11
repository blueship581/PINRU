package task

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	appgit "github.com/blueship581/pinru/app/git"
	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func strPtr(value string) *string {
	return &value
}

func intPtr(value int) *int {
	return &value
}

func boolTestPtr(value bool) *bool {
	return &value
}

func TestCreateTaskUsesProjectScopedIdentity(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	projectAID := "project-1710000000001"
	projectBID := "project-1710000000002"

	taskA, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectAID,
	})
	if err != nil {
		t.Fatalf("CreateTask(projectA) error = %v", err)
	}

	taskB, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectBID,
	})
	if err != nil {
		t.Fatalf("CreateTask(projectB) error = %v", err)
	}

	if taskA.ID == taskB.ID {
		t.Fatalf("task ids should be different across project configs, got %q", taskA.ID)
	}
	if taskA.ID == legacyTaskID(1849) || taskB.ID == legacyTaskID(1849) {
		t.Fatalf("expected project-scoped task id, got %q and %q", taskA.ID, taskB.ID)
	}

	tasks, err := testStore.ListTasks(nil)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 2 {
		t.Fatalf("ListTasks() count = %d, want 2", len(tasks))
	}
}

func TestCreateTaskRejectsDuplicateWithinSameProject(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	projectID := "project-1710000000001"

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	}); err != nil {
		t.Fatalf("first CreateTask() error = %v", err)
	}

	_, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Feature迭代",
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	})
	if err == nil {
		t.Fatalf("expected duplicate task error")
	}
	if !strings.Contains(err.Error(), "当前项目下题卡已存在") {
		t.Fatalf("unexpected duplicate error = %q", err.Error())
	}
}

func TestCreateTaskAllowsMultipleClaimSetsWithinSameProject(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	projectID := "project-1710000000001"

	taskA, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ClaimSequence:   intPtr(1),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	})
	if err != nil {
		t.Fatalf("CreateTask(claim 1) error = %v", err)
	}

	taskB, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ClaimSequence:   intPtr(2),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &projectID,
	})
	if err != nil {
		t.Fatalf("CreateTask(claim 2) error = %v", err)
	}

	if taskA.ID == taskB.ID {
		t.Fatalf("task ids should differ, got %q", taskA.ID)
	}
	if !strings.HasSuffix(taskA.ID, "label-01849-1") {
		t.Fatalf("taskA.ID = %q, want suffix label-01849-1", taskA.ID)
	}
	if !strings.HasSuffix(taskB.ID, "label-01849-2") {
		t.Fatalf("taskB.ID = %q, want suffix label-01849-2", taskB.ID)
	}
}

func TestAddModelRunCopiesSourceIntoNewModelFolder(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	taskDir := t.TempDir()
	sourcePath := filepath.Join(taskDir, "ORIGIN")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte("source"), 0o644); err != nil {
		t.Fatalf("WriteFile(source) error = %v", err)
	}

	taskID := "task-add-model-copy"
	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &taskDir,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-add-model",
		TaskID:    taskID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}

	s := &TaskService{store: testStore}
	if err := s.AddModelRun(AddModelRunRequest{
		TaskID:    taskID,
		ModelName: "new-model",
	}); err != nil {
		t.Fatalf("AddModelRun() error = %v", err)
	}

	targetPath := filepath.Join(taskDir, "new-model")
	if content, err := os.ReadFile(filepath.Join(targetPath, "README.md")); err != nil {
		t.Fatalf("ReadFile(copied) error = %v", err)
	} else if string(content) != "source" {
		t.Fatalf("copied content = %q, want source", string(content))
	}

	run, err := testStore.GetModelRun(taskID, "new-model")
	if err != nil {
		t.Fatalf("GetModelRun(new-model) error = %v", err)
	}
	if run == nil {
		t.Fatalf("expected new model run")
	}
	if run.LocalPath == nil || !util.SamePath(*run.LocalPath, targetPath) {
		t.Fatalf("LocalPath = %v, want %q", run.LocalPath, targetPath)
	}
}

func TestAddModelRunDoesNotCreateRecordWhenTargetFolderExists(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	taskDir := t.TempDir()
	sourcePath := filepath.Join(taskDir, "ORIGIN")
	targetPath := filepath.Join(taskDir, "new-model")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(targetPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(targetPath) error = %v", err)
	}

	taskID := "task-add-model-existing-folder"
	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1850,
		ProjectName:     "label-01850",
		TaskType:        "Bug修复",
		LocalPath:       &taskDir,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-existing-folder",
		TaskID:    taskID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}

	s := &TaskService{store: testStore}
	err := s.AddModelRun(AddModelRunRequest{
		TaskID:    taskID,
		ModelName: "new-model",
	})
	if err == nil {
		t.Fatalf("expected target folder exists error")
	}
	if !strings.Contains(err.Error(), "已存在") {
		t.Fatalf("error = %q, want target exists message", err.Error())
	}

	run, err := testStore.GetModelRun(taskID, "new-model")
	if err != nil {
		t.Fatalf("GetModelRun(new-model) error = %v", err)
	}
	if run != nil {
		t.Fatalf("run should not be created when copy fails: %+v", run)
	}
}

func TestAddProjectModelRunCopiesModelForAllProjectTasks(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	projectID := "project-add-model-all"
	taskIDs := []string{"task-project-model-1", "task-project-model-2"}
	for index, taskID := range taskIDs {
		taskDir := t.TempDir()
		sourcePath := filepath.Join(taskDir, "ORIGIN")
		if err := os.MkdirAll(sourcePath, 0o755); err != nil {
			t.Fatalf("MkdirAll(sourcePath) error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte(taskID), 0o644); err != nil {
			t.Fatalf("WriteFile(source) error = %v", err)
		}
		if err := testStore.CreateTask(store.Task{
			ID:              taskID,
			GitLabProjectID: int64(2000 + index),
			ProjectName:     taskID,
			TaskType:        "Bug修复",
			LocalPath:       &taskDir,
			ProjectConfigID: &projectID,
		}); err != nil {
			t.Fatalf("CreateTask(%s) error = %v", taskID, err)
		}
		if err := testStore.CreateModelRun(store.ModelRun{
			ID:        "run-origin-" + taskID,
			TaskID:    taskID,
			ModelName: "ORIGIN",
			LocalPath: &sourcePath,
		}); err != nil {
			t.Fatalf("CreateModelRun(ORIGIN %s) error = %v", taskID, err)
		}
	}

	otherProjectID := "project-other"
	if err := testStore.CreateTask(store.Task{
		ID:              "task-other-project",
		GitLabProjectID: 3000,
		ProjectName:     "other",
		ProjectConfigID: &otherProjectID,
	}); err != nil {
		t.Fatalf("CreateTask(other) error = %v", err)
	}

	s := &TaskService{store: testStore}
	result, err := s.AddProjectModelRun(AddProjectModelRunRequest{
		ProjectConfigID: projectID,
		ModelName:       "new-model",
	})
	if err != nil {
		t.Fatalf("AddProjectModelRun() error = %v", err)
	}
	if result.Total != 2 || result.Created != 2 || result.Skipped != 0 || len(result.Failed) != 0 {
		t.Fatalf("result = %+v, want total=2 created=2 skipped=0 failed=0", result)
	}

	for _, taskID := range taskIDs {
		run, err := testStore.GetModelRun(taskID, "new-model")
		if err != nil {
			t.Fatalf("GetModelRun(%s, new-model) error = %v", taskID, err)
		}
		if run == nil || run.LocalPath == nil {
			t.Fatalf("expected new model run with local path for %s, got %+v", taskID, run)
		}
		if content, err := os.ReadFile(filepath.Join(*run.LocalPath, "README.md")); err != nil {
			t.Fatalf("ReadFile(copied %s) error = %v", taskID, err)
		} else if string(content) != taskID {
			t.Fatalf("copied content for %s = %q", taskID, string(content))
		}
	}

	run, err := testStore.GetModelRun("task-other-project", "new-model")
	if err != nil {
		t.Fatalf("GetModelRun(other, new-model) error = %v", err)
	}
	if run != nil {
		t.Fatalf("other project task should not be modified: %+v", run)
	}
}

func TestAddProjectModelRunSkipsExistingModelRuns(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	projectID := "project-add-model-skip"
	taskDir := t.TempDir()
	sourcePath := filepath.Join(taskDir, "ORIGIN")
	existingPath := filepath.Join(taskDir, "new-model")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(existingPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(existingPath) error = %v", err)
	}
	taskID := "task-project-model-skip"
	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 2100,
		ProjectName:     "skip",
		LocalPath:       &taskDir,
		ProjectConfigID: &projectID,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-skip",
		TaskID:    taskID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-existing-skip",
		TaskID:    taskID,
		ModelName: "new-model",
		LocalPath: &existingPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(existing) error = %v", err)
	}

	s := &TaskService{store: testStore}
	result, err := s.AddProjectModelRun(AddProjectModelRunRequest{
		ProjectConfigID: projectID,
		ModelName:       "new-model",
	})
	if err != nil {
		t.Fatalf("AddProjectModelRun() error = %v", err)
	}
	if result.Total != 1 || result.Created != 0 || result.Skipped != 1 || len(result.Failed) != 0 {
		t.Fatalf("result = %+v, want skipped existing run", result)
	}
	if len(result.Results) != 1 || result.Results[0].Status != "skipped" {
		t.Fatalf("results = %+v, want one skipped item", result.Results)
	}
}

func TestAddProjectModelRunContinuesAfterTaskFailure(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	projectID := "project-add-model-partial"
	type taskFixture struct {
		id                  string
		prepareTargetFolder bool
	}
	fixtures := []taskFixture{
		{id: "task-project-model-ok-1"},
		{id: "task-project-model-fail", prepareTargetFolder: true},
		{id: "task-project-model-ok-2"},
	}
	for index, fixture := range fixtures {
		taskDir := t.TempDir()
		sourcePath := filepath.Join(taskDir, "ORIGIN")
		if err := os.MkdirAll(sourcePath, 0o755); err != nil {
			t.Fatalf("MkdirAll(sourcePath) error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte(fixture.id), 0o644); err != nil {
			t.Fatalf("WriteFile(source) error = %v", err)
		}
		if fixture.prepareTargetFolder {
			if err := os.MkdirAll(filepath.Join(taskDir, "new-model"), 0o755); err != nil {
				t.Fatalf("MkdirAll(target) error = %v", err)
			}
		}
		if err := testStore.CreateTask(store.Task{
			ID:              fixture.id,
			GitLabProjectID: int64(2200 + index),
			ProjectName:     fixture.id,
			LocalPath:       &taskDir,
			ProjectConfigID: &projectID,
		}); err != nil {
			t.Fatalf("CreateTask(%s) error = %v", fixture.id, err)
		}
		if err := testStore.CreateModelRun(store.ModelRun{
			ID:        "run-origin-" + fixture.id,
			TaskID:    fixture.id,
			ModelName: "ORIGIN",
			LocalPath: &sourcePath,
		}); err != nil {
			t.Fatalf("CreateModelRun(ORIGIN %s) error = %v", fixture.id, err)
		}
	}

	s := &TaskService{store: testStore}
	result, err := s.AddProjectModelRun(AddProjectModelRunRequest{
		ProjectConfigID: projectID,
		ModelName:       "new-model",
	})
	if err != nil {
		t.Fatalf("AddProjectModelRun() error = %v", err)
	}
	if result.Total != 3 || result.Created != 2 || result.Skipped != 0 || len(result.Failed) != 1 {
		t.Fatalf("result = %+v, want total=3 created=2 failed=1", result)
	}
	if result.Failed[0].TaskID != "task-project-model-fail" {
		t.Fatalf("failed task = %+v, want task-project-model-fail", result.Failed[0])
	}

	for _, taskID := range []string{"task-project-model-ok-1", "task-project-model-ok-2"} {
		run, err := testStore.GetModelRun(taskID, "new-model")
		if err != nil {
			t.Fatalf("GetModelRun(%s, new-model) error = %v", taskID, err)
		}
		if run == nil {
			t.Fatalf("expected new model run for %s", taskID)
		}
	}
	run, err := testStore.GetModelRun("task-project-model-fail", "new-model")
	if err != nil {
		t.Fatalf("GetModelRun(failed, new-model) error = %v", err)
	}
	if run != nil {
		t.Fatalf("failed task should not create run: %+v", run)
	}
}

func TestCreateTaskEnforcesPerProjectTaskTypeUpperLimit(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:             "project-limit",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-demo",
		CloneBasePath:  t.TempDir(),
		Models:         "ORIGIN",
		TaskTypes:      `["Bug修复"]`,
		TaskTypeQuotas: `{"Bug修复":2}`,
		TaskTypeTotals: `{"Bug修复":10}`,
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	s := &TaskService{store: testStore}

	for _, sequence := range []int{1, 2} {
		if _, err := s.CreateTask(CreateTaskRequest{
			GitLabProjectID: 1849,
			ProjectName:     "label-01849",
			TaskType:        "Bug修复",
			ClaimSequence:   intPtr(sequence),
			Models:          []string{"ORIGIN"},
			ProjectConfigID: &project.ID,
		}); err != nil {
			t.Fatalf("CreateTask(sequence=%d) error = %v", sequence, err)
		}
	}

	_, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ClaimSequence:   intPtr(3),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	})
	if err == nil {
		t.Fatalf("expected upper-limit error")
	}
	if !strings.Contains(err.Error(), "已达上限 2") {
		t.Fatalf("unexpected upper-limit error = %q", err.Error())
	}
}

func TestCreateTaskEnforcesPerProjectTaskTypeUpperLimitForLegacyLocalTasks(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:             "project-local-limit",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-demo",
		CloneBasePath:  t.TempDir(),
		Models:         "ORIGIN",
		TaskTypes:      `["代码生成"]`,
		TaskTypeQuotas: `{"代码生成":2}`,
		TaskTypeTotals: `{"代码生成":10}`,
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	s := &TaskService{store: testStore}
	projectName := "B-715"
	legacyLocalID := appgit.BuildLegacyDirectorySyntheticProjectID(projectName)
	newQuestionBankID := appgit.BuildQuestionBankLocalSyntheticProjectID(projectName)

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: legacyLocalID,
		ProjectName:     projectName,
		TaskType:        "代码生成",
		ClaimSequence:   intPtr(1),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	}); err != nil {
		t.Fatalf("CreateTask(legacy local) error = %v", err)
	}

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: newQuestionBankID,
		ProjectName:     projectName,
		TaskType:        "代码生成",
		ClaimSequence:   intPtr(2),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	}); err != nil {
		t.Fatalf("CreateTask(question bank local seq2) error = %v", err)
	}

	_, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: newQuestionBankID,
		ProjectName:     projectName,
		TaskType:        "代码生成",
		ClaimSequence:   intPtr(3),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	})
	if err == nil {
		t.Fatalf("expected upper-limit error for legacy local compatibility")
	}
	if !strings.Contains(err.Error(), "已达上限 2") {
		t.Fatalf("unexpected upper-limit error = %q", err.Error())
	}
}

func TestUpdateTaskTypeEnforcesPerProjectTaskTypeUpperLimit(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:             "project-update-limit",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-demo",
		CloneBasePath:  t.TempDir(),
		Models:         "ORIGIN",
		TaskTypes:      `["Bug修复","Feature迭代"]`,
		TaskTypeQuotas: `{"Bug修复":1,"Feature迭代":2}`,
		TaskTypeTotals: `{"Bug修复":10,"Feature迭代":10}`,
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	s := &TaskService{store: testStore}

	featureTask, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Feature迭代",
		ClaimSequence:   intPtr(1),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	})
	if err != nil {
		t.Fatalf("CreateTask(feature) error = %v", err)
	}

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ClaimSequence:   intPtr(2),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	}); err != nil {
		t.Fatalf("CreateTask(bugfix) error = %v", err)
	}

	err = s.UpdateTaskType(featureTask.ID, "Bug修复")
	if err == nil {
		t.Fatalf("expected upper-limit error")
	}
	if !strings.Contains(err.Error(), "已达上限 1") {
		t.Fatalf("unexpected upper-limit error = %q", err.Error())
	}

	savedTask, err := testStore.GetTask(featureTask.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected saved task")
	}
	if savedTask.TaskType != "Feature迭代" {
		t.Fatalf("TaskType = %q, want %q", savedTask.TaskType, "Feature迭代")
	}
}

func TestUpdateTaskSessionListEnforcesPerProjectTaskTypeUpperLimit(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:             "project-session-limit",
		Name:           "Demo",
		GitLabURL:      "https://gitlab.example.com",
		GitLabToken:    "glpat-demo",
		CloneBasePath:  t.TempDir(),
		Models:         "ORIGIN\ncotv21-pro",
		TaskTypes:      `["Bug修复","Feature迭代"]`,
		TaskTypeQuotas: `{"Bug修复":1,"Feature迭代":2}`,
		TaskTypeTotals: `{"Bug修复":10,"Feature迭代":10}`,
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	s := &TaskService{store: testStore}

	featureTask, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Feature迭代",
		ClaimSequence:   intPtr(1),
		Models:          []string{"ORIGIN", "cotv21-pro"},
		ProjectConfigID: &project.ID,
	})
	if err != nil {
		t.Fatalf("CreateTask(feature) error = %v", err)
	}

	if _, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ClaimSequence:   intPtr(2),
		Models:          []string{"ORIGIN"},
		ProjectConfigID: &project.ID,
	}); err != nil {
		t.Fatalf("CreateTask(bugfix) error = %v", err)
	}

	modelRun, err := testStore.GetModelRun(featureTask.ID, "cotv21-pro")
	if err != nil {
		t.Fatalf("GetModelRun() error = %v", err)
	}
	if modelRun == nil {
		t.Fatalf("expected model run")
	}

	err = s.UpdateTaskSessionList(UpdateTaskSessionListRequest{
		ID:         featureTask.ID,
		ModelRunID: &modelRun.ID,
		SessionList: []store.TaskSession{
			{
				SessionID:    "sess-1",
				TaskType:     "Bug修复",
				ConsumeQuota: true,
				IsCompleted:  boolTestPtr(true),
				IsSatisfied:  boolTestPtr(true),
			},
		},
	})
	if err == nil {
		t.Fatalf("expected upper-limit error")
	}
	if !strings.Contains(err.Error(), "已达上限 1") {
		t.Fatalf("unexpected upper-limit error = %q", err.Error())
	}

	savedTask, err := testStore.GetTask(featureTask.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected saved task")
	}
	if savedTask.TaskType != "Feature迭代" {
		t.Fatalf("TaskType = %q, want %q", savedTask.TaskType, "Feature迭代")
	}
}

func TestCreateTaskNormalizesStoredPaths(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	sep := string(filepath.Separator)
	base := t.TempDir()
	localPath := base + sep + sep + "pinru" + sep + sep + sep + "label-01808-comparison"
	sourcePath := base + sep + sep + "pinru" + sep + sep + sep + "label-01808-comparison" + sep + sep + sep + sep + "01808-comparison"

	task, err := s.CreateTask(CreateTaskRequest{
		GitLabProjectID: 1808,
		ProjectName:     "label-01808",
		TaskType:        "未归类",
		LocalPath:       &localPath,
		SourceModelName: strPtr("ORIGIN"),
		SourceLocalPath: &sourcePath,
		Models:          []string{"ORIGIN", "cotv21-pro"},
	})
	if err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	wantLocal := filepath.Join(base, "pinru", "label-01808-comparison")
	if task.LocalPath == nil || *task.LocalPath != wantLocal {
		t.Fatalf("task.LocalPath = %v, want %q", task.LocalPath, wantLocal)
	}

	runs, err := testStore.ListModelRuns(task.ID)
	if err != nil {
		t.Fatalf("ListModelRuns() error = %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("ListModelRuns() count = %d, want 2", len(runs))
	}

	modelPaths := make(map[string]string, len(runs))
	for _, run := range runs {
		if run.LocalPath != nil {
			modelPaths[run.ModelName] = *run.LocalPath
		}
	}
	wantOrigin := filepath.Join(base, "pinru", "label-01808-comparison", "01808-comparison")
	if modelPaths["ORIGIN"] != wantOrigin {
		t.Fatalf("ORIGIN path = %q, want %q", modelPaths["ORIGIN"], wantOrigin)
	}
	wantModel := filepath.Join(base, "pinru", "label-01808-comparison", "cotv21-pro")
	if modelPaths["cotv21-pro"] != wantModel {
		t.Fatalf("cotv21-pro path = %q, want %q", modelPaths["cotv21-pro"], wantModel)
	}
}

func TestDeleteTaskRemovesManagedTaskDirectory(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:            "project-1",
		Name:          "Demo",
		GitLabURL:     "https://gitlab.example.com",
		GitLabToken:   "glpat-demo",
		CloneBasePath: cloneBasePath,
		Models:        "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	localPath := util.BuildManagedTaskFolderPath(cloneBasePath, "label-01849", "Bug修复")
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(localPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-managed",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &localPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask() error = %v", err)
	}

	if _, err := os.Stat(localPath); !os.IsNotExist(err) {
		t.Fatalf("managed task directory should be removed, stat err = %v", err)
	}
}

func TestDeleteTaskKeepsUnmanagedDirectory(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:            "project-2",
		Name:          "Demo",
		GitLabURL:     "https://gitlab.example.com",
		GitLabToken:   "glpat-demo",
		CloneBasePath: cloneBasePath,
		Models:        "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	unmanagedPath := filepath.Join(t.TempDir(), "external-workdir")
	if err := os.MkdirAll(unmanagedPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(unmanagedPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-unmanaged",
		GitLabProjectID: 1850,
		ProjectName:     "label-01850",
		TaskType:        "Bug修复",
		LocalPath:       &unmanagedPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask() error = %v", err)
	}

	if _, err := os.Stat(unmanagedPath); err != nil {
		t.Fatalf("unmanaged directory should be kept, stat err = %v", err)
	}

	tasks, err := testStore.ListTasks(nil)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("ListTasks() count = %d, want 0", len(tasks))
	}
}

func TestDeleteTaskRemovesManagedTaskDirectoryWithClaimSequence(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:            "project-3",
		Name:          "Demo",
		GitLabURL:     "https://gitlab.example.com",
		GitLabToken:   "glpat-demo",
		CloneBasePath: cloneBasePath,
		Models:        "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	localPath := util.BuildManagedTaskFolderPathWithSequence(cloneBasePath, "label-01849", "Bug修复", 2)
	if err := os.MkdirAll(localPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(localPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-managed-claim-2",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &localPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	if err := s.DeleteTask(task.ID); err != nil {
		t.Fatalf("DeleteTask() error = %v", err)
	}

	if _, err := os.Stat(localPath); !os.IsNotExist(err) {
		t.Fatalf("managed claim directory should be removed, stat err = %v", err)
	}
}

func TestResolveTaskLocalFolderPrefersTaskPath(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	taskPath := filepath.Join(t.TempDir(), "label-01849-Bug修复")
	if err := os.MkdirAll(taskPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(taskPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-root",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &taskPath,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != taskPath {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, taskPath)
	}
}

func TestResolveTaskLocalFolderFallsBackToSharedModelParent(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	taskRoot := filepath.Join(t.TempDir(), "label-01849-Bug修复")
	originPath := filepath.Join(taskRoot, "ORIGIN")
	modelPath := filepath.Join(taskRoot, "cotv21-pro")
	if err := os.MkdirAll(originPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(originPath) error = %v", err)
	}
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-model-parent",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{
		{
			ID:        "run-origin",
			TaskID:    task.ID,
			ModelName: "ORIGIN",
			LocalPath: &originPath,
		},
		{
			ID:        "run-model",
			TaskID:    task.ID,
			ModelName: "cotv21-pro",
			LocalPath: &modelPath,
		},
	}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != taskRoot {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, taskRoot)
	}
}

func TestResolveTaskLocalFolderReturnsSingleModelPath(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	modelPath := filepath.Join(t.TempDir(), "cotv21-pro")
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-open-single-model",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
	}
	modelRuns := []store.ModelRun{
		{
			ID:        "run-model",
			TaskID:    task.ID,
			ModelName: "cotv21-pro",
			LocalPath: &modelPath,
		},
	}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}

	resolved, err := s.resolveTaskLocalFolder(&task)
	if err != nil {
		t.Fatalf("resolveTaskLocalFolder() error = %v", err)
	}
	if resolved != modelPath {
		t.Fatalf("resolveTaskLocalFolder() = %q, want %q", resolved, modelPath)
	}
}

func TestListTaskChildDirectoriesIncludesImmediateChildrenAndMatchesModelRuns(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	s := &TaskService{store: testStore}
	taskRoot := filepath.Join(t.TempDir(), "label-01849-Bug修复")
	sourcePath := filepath.Join(taskRoot, "01849-bug修复")
	modelPath := filepath.Join(taskRoot, "cotv21-pro")
	scratchPath := filepath.Join(taskRoot, "scratch")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}
	if err := os.MkdirAll(scratchPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(scratchPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(taskRoot, "任务提示词.md"), []byte("prompt"), 0o644); err != nil {
		t.Fatalf("WriteFile(prompt) error = %v", err)
	}

	task := store.Task{
		ID:              "task-child-directories",
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		LocalPath:       &taskRoot,
	}
	modelRuns := []store.ModelRun{
		{
			ID:           "run-origin",
			TaskID:       task.ID,
			ModelName:    "ORIGIN",
			LocalPath:    &sourcePath,
			ReviewStatus: "pass",
			ReviewRound:  2,
		},
		{
			ID:        "run-model",
			TaskID:    task.ID,
			ModelName: "cotv21-pro",
			LocalPath: &modelPath,
		},
	}
	if err := testStore.CreateTaskWithModelRuns(task, modelRuns); err != nil {
		t.Fatalf("CreateTaskWithModelRuns() error = %v", err)
	}
	if err := testStore.UpdateModelRunReview("run-origin", "pass", 2, nil); err != nil {
		t.Fatalf("UpdateModelRunReview(run-origin) error = %v", err)
	}

	children, err := s.ListTaskChildDirectories(task.ID)
	if err != nil {
		t.Fatalf("ListTaskChildDirectories() error = %v", err)
	}
	if len(children) != 3 {
		t.Fatalf("ListTaskChildDirectories() count = %d, want 3", len(children))
	}
	if children[0].Name != "01849-bug修复" || !children[0].IsSource {
		t.Fatalf("first child = %+v, want source directory first", children[0])
	}

	byName := make(map[string]TaskChildDirectory, len(children))
	for _, child := range children {
		byName[child.Name] = child
	}

	sourceChild, ok := byName["01849-bug修复"]
	if !ok {
		t.Fatalf("missing source child: %+v", children)
	}
	if sourceChild.ModelRunID == nil || *sourceChild.ModelRunID != "run-origin" {
		t.Fatalf("source child modelRunId = %v, want run-origin", sourceChild.ModelRunID)
	}
	if sourceChild.ModelName == nil || *sourceChild.ModelName != "ORIGIN" {
		t.Fatalf("source child modelName = %v, want ORIGIN", sourceChild.ModelName)
	}
	if sourceChild.ReviewStatus != "pass" || sourceChild.ReviewRound != 2 {
		t.Fatalf("source child review = %q/%d, want pass/2", sourceChild.ReviewStatus, sourceChild.ReviewRound)
	}

	scratchChild, ok := byName["scratch"]
	if !ok {
		t.Fatalf("missing scratch child: %+v", children)
	}
	if scratchChild.ModelRunID != nil || scratchChild.ModelName != nil {
		t.Fatalf("scratch child should not map to model run: %+v", scratchChild)
	}
}

func TestUpdateTaskTypeNormalizesManagedPaths(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:                "project-normalize",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     cloneBasePath,
		Models:            "ORIGIN\ncotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	const (
		projectName = "label-01849"
		oldTaskType = "Bug修复"
		newTaskType = "Feature迭代"
	)

	oldBasePath := util.BuildManagedTaskFolderPath(cloneBasePath, projectName, oldTaskType)
	oldSourcePath := util.BuildManagedSourceFolderPath(oldBasePath, 1849, oldTaskType)
	oldExecPath := filepath.Join(oldBasePath, "cotv21-pro")
	if err := os.MkdirAll(oldSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldSourcePath) error = %v", err)
	}
	if err := os.MkdirAll(oldExecPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldExecPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-normalize-type",
		GitLabProjectID: 1849,
		ProjectName:     projectName,
		TaskType:        oldTaskType,
		LocalPath:       &oldBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &oldSourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-cotv21",
		TaskID:    task.ID,
		ModelName: "cotv21-pro",
		LocalPath: &oldExecPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(cotv21-pro) error = %v", err)
	}

	s := &TaskService{
		store:  testStore,
		gitSvc: appgit.New(testStore),
	}
	if err := s.UpdateTaskType(task.ID, newTaskType); err != nil {
		t.Fatalf("UpdateTaskType() error = %v", err)
	}

	newBasePath := util.BuildManagedTaskFolderPath(cloneBasePath, projectName, newTaskType)
	newSourcePath := util.BuildManagedSourceFolderPath(newBasePath, 1849, newTaskType)
	newExecPath := filepath.Join(newBasePath, "cotv21-pro")

	if _, err := os.Stat(newBasePath); err != nil {
		t.Fatalf("Stat(newBasePath) error = %v", err)
	}
	if _, err := os.Stat(newSourcePath); err != nil {
		t.Fatalf("Stat(newSourcePath) error = %v", err)
	}
	if _, err := os.Stat(newExecPath); err != nil {
		t.Fatalf("Stat(newExecPath) error = %v", err)
	}
	if _, err := os.Stat(oldBasePath); !os.IsNotExist(err) {
		t.Fatalf("old base path should be renamed away, stat err = %v", err)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected saved task")
	}
	if savedTask.TaskType != newTaskType {
		t.Fatalf("TaskType = %q, want %q", savedTask.TaskType, newTaskType)
	}
	if savedTask.LocalPath == nil || !util.SamePath(*savedTask.LocalPath, newBasePath) {
		t.Fatalf("LocalPath = %v, want %q", savedTask.LocalPath, newBasePath)
	}
	if len(savedTask.SessionList) == 0 || savedTask.SessionList[0].TaskType != newTaskType {
		t.Fatalf("SessionList[0].TaskType = %+v, want %q", savedTask.SessionList, newTaskType)
	}

	sourceRun, err := testStore.GetModelRun(task.ID, "ORIGIN")
	if err != nil {
		t.Fatalf("GetModelRun(ORIGIN) error = %v", err)
	}
	if sourceRun == nil || sourceRun.LocalPath == nil || !util.SamePath(*sourceRun.LocalPath, newSourcePath) {
		t.Fatalf("ORIGIN local path = %v, want %q", sourceRun, newSourcePath)
	}

	execRun, err := testStore.GetModelRun(task.ID, "cotv21-pro")
	if err != nil {
		t.Fatalf("GetModelRun(cotv21-pro) error = %v", err)
	}
	if execRun == nil || execRun.LocalPath == nil || !util.SamePath(*execRun.LocalPath, newExecPath) {
		t.Fatalf("cotv21-pro local path = %v, want %q", execRun, newExecPath)
	}
}

func TestUpdateTaskTypePreservesClaimSequenceInManagedPaths(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	cloneBasePath := t.TempDir()
	project := store.Project{
		ID:                "project-normalize-seq",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     cloneBasePath,
		Models:            "ORIGIN\ncotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	const (
		projectName   = "label-01849"
		oldTaskType   = "Bug修复"
		newTaskType   = "Feature迭代"
		claimSequence = 2
	)

	oldBasePath := util.BuildManagedTaskFolderPathWithSequence(cloneBasePath, projectName, oldTaskType, claimSequence)
	oldSourcePath := util.BuildManagedSourceFolderPathWithSequence(oldBasePath, 1849, oldTaskType, claimSequence)
	oldExecPath := filepath.Join(oldBasePath, "cotv21-pro")
	if err := os.MkdirAll(oldSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldSourcePath) error = %v", err)
	}
	if err := os.MkdirAll(oldExecPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(oldExecPath) error = %v", err)
	}

	task := store.Task{
		ID:              "task-normalize-type-2",
		GitLabProjectID: 1849,
		ProjectName:     projectName,
		TaskType:        oldTaskType,
		LocalPath:       &oldBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-2",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &oldSourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-cotv21-2",
		TaskID:    task.ID,
		ModelName: "cotv21-pro",
		LocalPath: &oldExecPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(cotv21-pro) error = %v", err)
	}

	s := &TaskService{
		store:  testStore,
		gitSvc: appgit.New(testStore),
	}
	if err := s.UpdateTaskType(task.ID, newTaskType); err != nil {
		t.Fatalf("UpdateTaskType() error = %v", err)
	}

	newBasePath := util.BuildManagedTaskFolderPathWithSequence(cloneBasePath, projectName, newTaskType, claimSequence)
	newSourcePath := util.BuildManagedSourceFolderPathWithSequence(newBasePath, 1849, newTaskType, claimSequence)

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil || savedTask.LocalPath == nil || !util.SamePath(*savedTask.LocalPath, newBasePath) {
		t.Fatalf("LocalPath = %v, want %q", savedTask, newBasePath)
	}

	sourceRun, err := testStore.GetModelRun(task.ID, "ORIGIN")
	if err != nil {
		t.Fatalf("GetModelRun(ORIGIN) error = %v", err)
	}
	if sourceRun == nil || sourceRun.LocalPath == nil || !util.SamePath(*sourceRun.LocalPath, newSourcePath) {
		t.Fatalf("ORIGIN local path = %v, want %q", sourceRun, newSourcePath)
	}
}

func TestGetTaskReadmeReturnsRootReadmeUsingPriorityOrder(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-readme",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,model-a",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskPath := filepath.Join(project.CloneBasePath, "task-readme")
	sourcePath := filepath.Join(taskPath, "01849-未归类")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "readme.markdown"), []byte("fallback"), 0o644); err != nil {
		t.Fatalf("WriteFile(readme.markdown) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte("# Preferred\r\n\r\ncontent"), 0o644); err != nil {
		t.Fatalf("WriteFile(README.md) error = %v", err)
	}

	task := store.Task{
		ID:              "task-readme",
		GitLabProjectID: 1849,
		ProjectName:     "demo",
		TaskType:        "未归类",
		LocalPath:       &taskPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-readme",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	s := &TaskService{store: testStore}
	readme, err := s.GetTaskReadme(task.ID)
	if err != nil {
		t.Fatalf("GetTaskReadme() error = %v", err)
	}
	if readme == nil {
		t.Fatalf("expected readme")
	}
	if !strings.HasSuffix(readme.Path, "README.md") {
		t.Fatalf("Path = %q, want README.md", readme.Path)
	}
	if readme.Content != "# Preferred\n\ncontent" {
		t.Fatalf("Content = %q", readme.Content)
	}
}

func TestGetTaskReadmeReturnsNilWhenSourceRootHasNoReadme(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-readme-empty",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskPath := filepath.Join(project.CloneBasePath, "task-readme-empty")
	sourcePath := filepath.Join(taskPath, "01850-未归类")
	nestedPath := filepath.Join(sourcePath, "docs")
	if err := os.MkdirAll(nestedPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(nestedPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(nestedPath, "README.md"), []byte("nested only"), 0o644); err != nil {
		t.Fatalf("WriteFile(nested README) error = %v", err)
	}

	task := store.Task{
		ID:              "task-readme-empty",
		GitLabProjectID: 1850,
		ProjectName:     "demo-empty",
		TaskType:        "未归类",
		LocalPath:       &taskPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin-readme-empty",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	s := &TaskService{store: testStore}
	readme, err := s.GetTaskReadme(task.ID)
	if err != nil {
		t.Fatalf("GetTaskReadme() error = %v", err)
	}
	if readme != nil {
		t.Fatalf("expected nil readme, got %+v", readme)
	}
}

func TestGetTaskReadmeFallsBackToManagedSourceFolderNamedLikeParent(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-readme-parent-source",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-demo",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskPath := filepath.Join(project.CloneBasePath, "B-35-代码生成-1")
	sourcePath := filepath.Join(taskPath, "B-35-代码生成-1")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte("same-name source"), 0o644); err != nil {
		t.Fatalf("WriteFile(README.md) error = %v", err)
	}

	task := store.Task{
		ID:              "task-readme-parent-source",
		GitLabProjectID: 8_530_362_474_967_007,
		ProjectName:     "B-35",
		TaskType:        "代码生成",
		LocalPath:       &taskPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	s := &TaskService{store: testStore}
	readme, err := s.GetTaskReadme(task.ID)
	if err != nil {
		t.Fatalf("GetTaskReadme() error = %v", err)
	}
	if readme == nil {
		t.Fatalf("expected readme")
	}
	if !util.SamePath(filepath.Dir(readme.Path), sourcePath) {
		t.Fatalf("readme path = %q, want under %q", readme.Path, sourcePath)
	}
	if readme.Content != "same-name source" {
		t.Fatalf("Content = %q", readme.Content)
	}
}

func TestRewriteManagedClaimPathsRenamesDirsAndUpdatesRequest(t *testing.T) {
	cloneBase := t.TempDir()
	projectName := "label-01231"
	taskType := "代码生成"

	oldTaskFolderName := util.BuildManagedTaskFolderNameWithSequence(projectName, taskType, 1)
	newTaskFolderName := util.BuildManagedTaskFolderNameWithSequence(projectName, taskType, 8)

	oldTaskPath := filepath.Join(cloneBase, oldTaskFolderName)
	oldSourceFolderName := util.BuildManagedSourceFolderNameWithSequence(1231, taskType, 1)
	oldSourcePath := filepath.Join(oldTaskPath, oldSourceFolderName)

	if err := os.MkdirAll(oldSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	req := CreateTaskRequest{
		GitLabProjectID: 1231,
		ProjectName:     projectName,
		TaskType:        taskType,
		LocalPath:       strPtr(oldTaskPath),
		SourceLocalPath: strPtr(oldSourcePath),
	}

	updated, err := rewriteManagedClaimPaths(req, 1, 8)
	if err != nil {
		t.Fatalf("rewriteManagedClaimPaths() error = %v", err)
	}

	expectedTaskPath := filepath.Join(cloneBase, newTaskFolderName)
	expectedSourceFolderName := util.BuildManagedSourceFolderNameWithSequence(1231, taskType, 8)
	expectedSourcePath := filepath.Join(expectedTaskPath, expectedSourceFolderName)

	if updated.LocalPath == nil || *updated.LocalPath != expectedTaskPath {
		got := ""
		if updated.LocalPath != nil {
			got = *updated.LocalPath
		}
		t.Fatalf("LocalPath = %q, want %q", got, expectedTaskPath)
	}
	if updated.SourceLocalPath == nil || *updated.SourceLocalPath != expectedSourcePath {
		got := ""
		if updated.SourceLocalPath != nil {
			got = *updated.SourceLocalPath
		}
		t.Fatalf("SourceLocalPath = %q, want %q", got, expectedSourcePath)
	}

	if _, err := os.Stat(expectedTaskPath); err != nil {
		t.Fatalf("expected task dir %q to exist after rename: %v", expectedTaskPath, err)
	}
	if _, err := os.Stat(expectedSourcePath); err != nil {
		t.Fatalf("expected source dir %q to exist after rename: %v", expectedSourcePath, err)
	}
	if _, err := os.Stat(oldTaskPath); !os.IsNotExist(err) {
		t.Fatalf("old task dir %q should be gone, stat err = %v", oldTaskPath, err)
	}
}

func TestRewriteManagedClaimPathsNoOpWhenSequencesEqual(t *testing.T) {
	req := CreateTaskRequest{
		GitLabProjectID: 1231,
		ProjectName:     "label-01231",
		TaskType:        "代码生成",
		LocalPath:       strPtr("/tmp/whatever"),
	}

	updated, err := rewriteManagedClaimPaths(req, 5, 5)
	if err != nil {
		t.Fatalf("rewriteManagedClaimPaths() error = %v", err)
	}
	if updated.LocalPath == nil || *updated.LocalPath != "/tmp/whatever" {
		t.Fatalf("LocalPath should be unchanged, got %v", updated.LocalPath)
	}
}

func TestRewriteManagedClaimPathsLeavesNonManagedPathsAlone(t *testing.T) {
	cloneBase := t.TempDir()
	customPath := filepath.Join(cloneBase, "totally-custom-folder")
	if err := os.MkdirAll(customPath, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	req := CreateTaskRequest{
		GitLabProjectID: 1231,
		ProjectName:     "label-01231",
		TaskType:        "代码生成",
		LocalPath:       strPtr(customPath),
	}

	updated, err := rewriteManagedClaimPaths(req, 1, 8)
	if err != nil {
		t.Fatalf("rewriteManagedClaimPaths() error = %v", err)
	}
	if updated.LocalPath == nil || *updated.LocalPath != customPath {
		t.Fatalf("non-managed LocalPath should be untouched, got %v", updated.LocalPath)
	}
	if _, err := os.Stat(customPath); err != nil {
		t.Fatalf("custom dir should still exist: %v", err)
	}
}
