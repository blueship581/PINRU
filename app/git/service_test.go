package git

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blueship581/pinru/app/testutil"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

func TestInspectDirectoryReportsEmptiness(t *testing.T) {
	s := &GitService{}

	emptyDir := filepath.Join(t.TempDir(), "empty-project")
	if err := os.MkdirAll(emptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(emptyDir) error = %v", err)
	}

	emptyResult, err := s.InspectDirectory(emptyDir)
	if err != nil {
		t.Fatalf("InspectDirectory(emptyDir) error = %v", err)
	}
	if !emptyResult.Exists || !emptyResult.IsDir || !emptyResult.IsEmpty {
		t.Fatalf("unexpected empty directory result: %+v", emptyResult)
	}
	if emptyResult.Name != "empty-project" {
		t.Fatalf("emptyResult.Name = %q, want %q", emptyResult.Name, "empty-project")
	}

	nonEmptyDir := filepath.Join(t.TempDir(), "non-empty-project")
	if err := os.MkdirAll(nonEmptyDir, 0o755); err != nil {
		t.Fatalf("MkdirAll(nonEmptyDir) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyDir, "README.md"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	nonEmptyResult, err := s.InspectDirectory(nonEmptyDir)
	if err != nil {
		t.Fatalf("InspectDirectory(nonEmptyDir) error = %v", err)
	}
	if !nonEmptyResult.Exists || !nonEmptyResult.IsDir || nonEmptyResult.IsEmpty {
		t.Fatalf("unexpected non-empty directory result: %+v", nonEmptyResult)
	}
}

func TestSanitizeInspectPathStripsQuotesAndTrailingSeparators(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "plain", in: "/tmp/foo", want: "/tmp/foo"},
		{name: "surrounding_spaces", in: "  /tmp/foo  ", want: "/tmp/foo"},
		{name: "double_quoted", in: `"/tmp/foo"`, want: "/tmp/foo"},
		{name: "single_quoted", in: `'/tmp/foo'`, want: "/tmp/foo"},
		{name: "quoted_with_spaces", in: `  "/tmp/foo"  `, want: "/tmp/foo"},
		{name: "trailing_slash", in: "/tmp/foo/", want: "/tmp/foo"},
		{name: "trailing_backslash", in: `C:\Users\foo\`, want: `C:\Users\foo`},
		{name: "multiple_trailing", in: "/tmp/foo///", want: "/tmp/foo"},
		{name: "windows_drive_root_keeps_slash", in: `C:\`, want: `C:\`},
		{name: "empty", in: "   ", want: ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sanitizeInspectPath(c.in); got != c.want {
				t.Fatalf("sanitizeInspectPath(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestNormalizeManagedSourceFoldersSyncsTaskPromptArtifact(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "proj-1",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskBasePath := util.BuildManagedTaskFolderPath(project.CloneBasePath, "label-02898", "Bug修复")
	sourcePath := util.BuildManagedSourceFolderPath(taskBasePath, 2898, "Bug修复")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	promptText := strings.Join([]string{
		"修复项目概况刷新后未同步任务提示词的问题。",
		"保持现有目录结构和任务状态流转。",
	}, "\n")
	if err := os.WriteFile(filepath.Join(taskBasePath, "任务提示词.md"), []byte(promptText+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	task := store.Task{
		ID:              "label-02898",
		GitLabProjectID: 2898,
		ProjectName:     "label-02898",
		TaskType:        "Bug修复",
		LocalPath:       &taskBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.UpdateTaskStatus(task.ID, "Downloaded"); err != nil {
		t.Fatalf("UpdateTaskStatus() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-1",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	s := &GitService{store: testStore}
	result, err := s.NormalizeManagedSourceFolders(project.ID)
	if err != nil {
		t.Fatalf("NormalizeManagedSourceFolders() error = %v", err)
	}

	if result.UpdatedCount != 1 {
		t.Fatalf("UpdatedCount = %d, want 1", result.UpdatedCount)
	}
	if result.ErrorCount != 0 {
		t.Fatalf("ErrorCount = %d, want 0", result.ErrorCount)
	}
	if len(result.Details) != 1 {
		t.Fatalf("details len = %d, want 1", len(result.Details))
	}
	if result.Details[0].Status != "updated" {
		t.Fatalf("detail status = %q, want updated", result.Details[0].Status)
	}
	if !strings.Contains(result.Details[0].Message, "已同步任务提示词") {
		t.Fatalf("detail message = %q, want prompt sync hint", result.Details[0].Message)
	}

	savedTask, err := testStore.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask() error = %v", err)
	}
	if savedTask == nil {
		t.Fatalf("expected task after normalize")
	}
	if savedTask.Status != "PromptReady" {
		t.Fatalf("Status after normalize = %q, want PromptReady", savedTask.Status)
	}
	if savedTask.PromptGenerationStatus != "done" {
		t.Fatalf("PromptGenerationStatus after normalize = %q, want done", savedTask.PromptGenerationStatus)
	}
	if savedTask.PromptText == nil || *savedTask.PromptText != promptText {
		t.Fatalf("PromptText after normalize = %v, want %q", savedTask.PromptText, promptText)
	}
}

func TestNormalizeManagedSourceFoldersInitializesGitForExistingModelDirectories(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "proj-git",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,cotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	taskBasePath := util.BuildManagedTaskFolderPath(project.CloneBasePath, "label-03001", "Bug修复")
	sourcePath := util.BuildManagedSourceFolderPath(taskBasePath, 3001, "Bug修复")
	modelPath := filepath.Join(taskBasePath, "cotv21-pro")
	if err := os.MkdirAll(sourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(sourcePath) error = %v", err)
	}
	if err := os.MkdirAll(modelPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(modelPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(sourcePath, "README.md"), []byte("source"), 0o644); err != nil {
		t.Fatalf("WriteFile(source README) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(modelPath, "README.md"), []byte("model"), 0o644); err != nil {
		t.Fatalf("WriteFile(model README) error = %v", err)
	}
	initGitRepoInDir(t, sourcePath, "bugfix-sync")
	runGitInDir(t, sourcePath, "add", "README.md")
	runGitInDir(t, sourcePath, "commit", "-m", "initial source commit")

	task := store.Task{
		ID:              "label-03001",
		GitLabProjectID: 3001,
		ProjectName:     "label-03001",
		TaskType:        "Bug修复",
		LocalPath:       &taskBasePath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-origin",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &sourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun(ORIGIN) error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "run-model",
		TaskID:    task.ID,
		ModelName: "cotv21-pro",
		LocalPath: &modelPath,
	}); err != nil {
		t.Fatalf("CreateModelRun(model) error = %v", err)
	}

	s := &GitService{store: testStore}
	result, err := s.NormalizeManagedSourceFolders(project.ID)
	if err != nil {
		t.Fatalf("NormalizeManagedSourceFolders() error = %v", err)
	}

	if result.GitInitializedCount != 1 {
		t.Fatalf("GitInitializedCount = %d, want 1", result.GitInitializedCount)
	}
	if len(result.Details) != 1 {
		t.Fatalf("details len = %d, want 1", len(result.Details))
	}
	if result.Details[0].GitInitializedCount != 1 {
		t.Fatalf("detail GitInitializedCount = %d, want 1", result.Details[0].GitInitializedCount)
	}
	if !strings.Contains(result.Details[0].Message, "补 Git 基线") {
		t.Fatalf("detail message = %q, want git initialization hint", result.Details[0].Message)
	}

	if _, err := os.Stat(filepath.Join(modelPath, ".git")); err != nil {
		t.Fatalf("expected model path to have git metadata, stat err = %v", err)
	}
	if branch := gitOutputInDir(t, modelPath, "branch", "--show-current"); branch != "bugfix-sync" {
		t.Fatalf("model branch = %q, want bugfix-sync", branch)
	}
	if status := gitOutputInDir(t, modelPath, "status", "--short"); strings.TrimSpace(status) != "" {
		t.Fatalf("model git status = %q, want clean working tree", status)
	}
}

func TestPlanManagedClaimPathsStartsNumberingFromOneForMultiSet(t *testing.T) {
	s := &GitService{}

	plans, err := s.PlanManagedClaimPaths(t.TempDir(), "label-01849", 1849, "Bug修复", 3, "")
	if err != nil {
		t.Fatalf("PlanManagedClaimPaths() error = %v", err)
	}
	if len(plans) != 3 {
		t.Fatalf("plans len = %d, want 3", len(plans))
	}

	wantSequences := []int{1, 2, 3}
	for index, want := range wantSequences {
		if plans[index].Sequence != want {
			t.Fatalf("plans[%d].Sequence = %d, want %d", index, plans[index].Sequence, want)
		}
		if !strings.HasSuffix(plans[index].TaskPath, fmt.Sprintf("label-01849-bug修复-%d", want)) {
			t.Fatalf("plans[%d].TaskPath = %q", index, plans[index].TaskPath)
		}
		if !strings.HasSuffix(plans[index].SourcePath, fmt.Sprintf("01849-bug修复-%d", want)) {
			t.Fatalf("plans[%d].SourcePath = %q", index, plans[index].SourcePath)
		}
	}
}

func TestPlanManagedClaimPathsContinuesFromExistingFoldersAndTasks(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	basePath := t.TempDir()
	projectConfigID := "project-1"

	if err := os.MkdirAll(filepath.Join(basePath, "label-01849-bug修复"), 0o755); err != nil {
		t.Fatalf("MkdirAll(base claim dir) error = %v", err)
	}
	if err := os.MkdirAll(filepath.Join(basePath, "label-01849-bug修复-2"), 0o755); err != nil {
		t.Fatalf("MkdirAll(suffixed claim dir) error = %v", err)
	}

	taskID := "pproject-1__label-01849-3"
	if err := testStore.CreateTask(store.Task{
		ID:              taskID,
		GitLabProjectID: 1849,
		ProjectName:     "label-01849",
		TaskType:        "Bug修复",
		ProjectConfigID: &projectConfigID,
	}); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}

	s := &GitService{store: testStore}
	plans, err := s.PlanManagedClaimPaths(basePath, "label-01849", 1849, "Bug修复", 2, projectConfigID)
	if err != nil {
		t.Fatalf("PlanManagedClaimPaths() error = %v", err)
	}
	if len(plans) != 2 {
		t.Fatalf("plans len = %d, want 2", len(plans))
	}
	if plans[0].Sequence != 4 || plans[1].Sequence != 5 {
		t.Fatalf("plan sequences = [%d %d], want [4 5]", plans[0].Sequence, plans[1].Sequence)
	}
}

func TestPlanManagedClaimPathsReusesDeletedTaskSlot(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	basePath := t.TempDir()
	projectConfigID := "project-2"

	// 磁盘上只剩 -1 和 -3 的目录（-2 已被删除）
	if err := os.MkdirAll(filepath.Join(basePath, "label-01849-bug修复"), 0o755); err != nil {
		t.Fatalf("MkdirAll(seq-1 dir) error = %v", err)
	}
	if err := os.MkdirAll(filepath.Join(basePath, "label-01849-bug修复-3"), 0o755); err != nil {
		t.Fatalf("MkdirAll(seq-3 dir) error = %v", err)
	}

	// 数据库中同样只有序号 1 和 3 的 task（2 已删除）
	for _, seq := range []int{1, 3} {
		taskID := fmt.Sprintf("pproject-2__label-01849-%d", seq)
		if err := testStore.CreateTask(store.Task{
			ID:              taskID,
			GitLabProjectID: 1849,
			ProjectName:     "label-01849",
			TaskType:        "Bug修复",
			ProjectConfigID: &projectConfigID,
		}); err != nil {
			t.Fatalf("CreateTask(seq=%d) error = %v", seq, err)
		}
	}

	s := &GitService{store: testStore}
	plans, err := s.PlanManagedClaimPaths(basePath, "label-01849", 1849, "Bug修复", 2, projectConfigID)
	if err != nil {
		t.Fatalf("PlanManagedClaimPaths() error = %v", err)
	}
	if len(plans) != 2 {
		t.Fatalf("plans len = %d, want 2", len(plans))
	}
	// 应复用空位 2，再分配 4
	if plans[0].Sequence != 2 || plans[1].Sequence != 4 {
		t.Fatalf("plan sequences = [%d %d], want [2 4]", plans[0].Sequence, plans[1].Sequence)
	}
}

func TestImportLocalSourcesImportsZipArchiveAndAvoidsDuplicateReimport(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-local-zip",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,claude-code",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	archivePath := filepath.Join(project.CloneBasePath, "local-demo.zip")
	createZipArchive(t, archivePath, map[string]string{
		"local-demo/README.md": "# Demo\n",
		"local-demo/main.go":   "package main\n",
	})

	s := &GitService{store: testStore}
	result, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("ImportLocalSources() error = %v", err)
	}
	if result.ImportedCount != 1 || result.SkippedCount != 0 || result.ErrorCount != 0 {
		t.Fatalf("unexpected import summary: %+v", result)
	}

	if len(result.Details) != 1 {
		t.Fatalf("details len = %d, want 1", len(result.Details))
	}
	tasks, err := testStore.ListTasks(&project.ID)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks len = %d, want 0", len(tasks))
	}

	items, err := testStore.ListQuestionBankItems(project.ID)
	if err != nil {
		t.Fatalf("ListQuestionBankItems() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("question bank items len = %d, want 1", len(items))
	}
	item := items[0]
	if item.SourceKind != "local_archive" {
		t.Fatalf("SourceKind = %q, want local_archive", item.SourceKind)
	}
	if item.ArchivePath == nil || strings.TrimSpace(*item.ArchivePath) == "" {
		t.Fatalf("expected archived source path, got %+v", item)
	}

	assertPathExists(t, filepath.Join(item.SourcePath, "README.md"))
	assertPathExists(t, filepath.Join(item.SourcePath, ".git"))
	assertPathNotExists(t, filepath.Join(item.SourcePath, "local-demo"))
	assertPathExists(t, *item.ArchivePath)
	assertPathNotExists(t, archivePath)

	createZipArchive(t, archivePath, map[string]string{
		"local-demo/README.md": "# Demo duplicate\n",
	})

	secondResult, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("second ImportLocalSources() error = %v", err)
	}
	if secondResult.ImportedCount != 0 || secondResult.SkippedCount != 1 || secondResult.ErrorCount != 0 {
		t.Fatalf("unexpected second import summary: %+v", secondResult)
	}
	if !strings.Contains(secondResult.Details[0].Message, "题库已存在题目") {
		t.Fatalf("skip message = %q, want existing question bank hint", secondResult.Details[0].Message)
	}
}

func TestImportLocalSourcesImportsSevenZipArchive(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-local-7z",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,cotv21-pro",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	archivePath := filepath.Join(project.CloneBasePath, "fixture.7z")
	copyFile(t, sevenZipFixturePath(t, "t0.7z"), archivePath)

	s := &GitService{store: testStore}
	result, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("ImportLocalSources() error = %v", err)
	}
	if result.ImportedCount != 1 || result.ErrorCount != 0 {
		t.Fatalf("unexpected import summary: %+v", result)
	}

	tasks, err := testStore.ListTasks(&project.ID)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks len = %d, want 0", len(tasks))
	}

	items, err := testStore.ListQuestionBankItems(project.ID)
	if err != nil {
		t.Fatalf("ListQuestionBankItems() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("question bank items len = %d, want 1", len(items))
	}
	item := items[0]

	assertPathExists(t, filepath.Join(item.SourcePath, ".git"))

	entries, err := os.ReadDir(item.SourcePath)
	if err != nil {
		t.Fatalf("ReadDir(source) error = %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("expected extracted source contents")
	}
}

func TestImportLocalSourcesMigratesDirectoryAndPrefersDirectoryOverArchive(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-local-dir",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,model-a",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	dirPath := filepath.Join(project.CloneBasePath, "sample")
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		t.Fatalf("MkdirAll(dirPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(dirPath, "README.md"), []byte("# demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}
	archivePath := filepath.Join(project.CloneBasePath, "sample.zip")
	createZipArchive(t, archivePath, map[string]string{
		"sample/README.md": "# archive\n",
	})

	s := &GitService{store: testStore}
	result, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("ImportLocalSources() error = %v", err)
	}
	if result.ImportedCount != 1 || result.SkippedCount != 1 || result.ErrorCount != 0 {
		t.Fatalf("unexpected import summary: %+v", result)
	}

	assertPathNotExists(t, dirPath)
	assertPathExists(t, archivePath)

	tasks, err := testStore.ListTasks(&project.ID)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks len = %d, want 0", len(tasks))
	}

	items, err := testStore.ListQuestionBankItems(project.ID)
	if err != nil {
		t.Fatalf("ListQuestionBankItems() error = %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("question bank items len = %d, want 1", len(items))
	}
	if items[0].SourceKind != "local_directory" {
		t.Fatalf("SourceKind = %q, want local_directory", items[0].SourceKind)
	}
	assertPathExists(t, filepath.Join(items[0].SourcePath, "README.md"))
	assertPathExists(t, filepath.Join(items[0].SourcePath, ".git"))

	skippedArchive := false
	for _, detail := range result.Details {
		if detail.Kind == "archive" && strings.Contains(detail.Message, "同名已解压目录") {
			skippedArchive = true
		}
	}
	if !skippedArchive {
		t.Fatalf("expected archive conflict detail, got %+v", result.Details)
	}
}

func TestImportLocalSourcesSkipsTrackedHiddenAndModelDirectories(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-local-skip",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,model-a",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	trackedTaskPath := filepath.Join(project.CloneBasePath, "tracked")
	trackedSourcePath := filepath.Join(trackedTaskPath, "origin")
	if err := os.MkdirAll(trackedSourcePath, 0o755); err != nil {
		t.Fatalf("MkdirAll(trackedSourcePath) error = %v", err)
	}
	task := store.Task{
		ID:              "tracked-task",
		GitLabProjectID: 1849,
		ProjectName:     "tracked",
		TaskType:        "未归类",
		LocalPath:       &trackedTaskPath,
		ProjectConfigID: &project.ID,
	}
	if err := testStore.CreateTask(task); err != nil {
		t.Fatalf("CreateTask() error = %v", err)
	}
	if err := testStore.CreateModelRun(store.ModelRun{
		ID:        "tracked-origin",
		TaskID:    task.ID,
		ModelName: "ORIGIN",
		LocalPath: &trackedSourcePath,
	}); err != nil {
		t.Fatalf("CreateModelRun() error = %v", err)
	}

	if err := os.MkdirAll(filepath.Join(project.CloneBasePath, ".hidden"), 0o755); err != nil {
		t.Fatalf("MkdirAll(hidden) error = %v", err)
	}
	if err := os.MkdirAll(filepath.Join(project.CloneBasePath, "ORIGIN"), 0o755); err != nil {
		t.Fatalf("MkdirAll(modelDir) error = %v", err)
	}

	s := &GitService{store: testStore}
	result, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("ImportLocalSources() error = %v", err)
	}
	if result.ImportedCount != 0 || result.ErrorCount != 0 {
		t.Fatalf("unexpected import summary: %+v", result)
	}
	if result.SkippedCount != 0 {
		t.Fatalf("SkippedCount = %d, want 0 for silently ignored managed items", result.SkippedCount)
	}
}

func TestImportLocalSourcesRejectsUnsafeArchiveAndCleansUp(t *testing.T) {
	testStore := testutil.OpenTestStore(t)
	defer testStore.Close()

	project := store.Project{
		ID:                "project-local-bad",
		Name:              "Demo",
		GitLabURL:         "https://gitlab.example.com",
		GitLabToken:       "glpat-test",
		CloneBasePath:     t.TempDir(),
		Models:            "ORIGIN,model-a",
		SourceModelFolder: "ORIGIN",
	}
	if err := testStore.CreateProject(project); err != nil {
		t.Fatalf("CreateProject() error = %v", err)
	}

	archivePath := filepath.Join(project.CloneBasePath, "bad.zip")
	createZipArchive(t, archivePath, map[string]string{
		"../evil.txt": "nope",
	})

	s := &GitService{store: testStore}
	result, err := s.ImportLocalSources(project.ID)
	if err != nil {
		t.Fatalf("ImportLocalSources() error = %v", err)
	}
	if result.ImportedCount != 0 || result.ErrorCount != 1 {
		t.Fatalf("unexpected import summary: %+v", result)
	}

	tasks, err := testStore.ListTasks(&project.ID)
	if err != nil {
		t.Fatalf("ListTasks() error = %v", err)
	}
	if len(tasks) != 0 {
		t.Fatalf("tasks len = %d, want 0", len(tasks))
	}

	items, err := testStore.ListQuestionBankItems(project.ID)
	if err != nil {
		t.Fatalf("ListQuestionBankItems() error = %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("question bank items len = %d, want 0", len(items))
	}

	entries, err := os.ReadDir(project.CloneBasePath)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("unexpected base path entries after failed import: %+v", entries)
	}
	assertPathExists(t, archivePath)

	questionBankSources := util.BuildQuestionBankSourcesPath(project.CloneBasePath)
	sourceEntries, err := os.ReadDir(questionBankSources)
	if err != nil {
		t.Fatalf("ReadDir(questionBankSources) error = %v", err)
	}
	if len(sourceEntries) != 0 {
		t.Fatalf("question_bank/sources should be empty after cleanup, got %+v", sourceEntries)
	}
}

func initGitRepoInDir(t *testing.T, dir, branch string) {
	t.Helper()
	if err := runGitCommand(dir, "init", "-b", branch); err != nil {
		if err := runGitCommand(dir, "init"); err != nil {
			t.Fatalf("git init error = %v", err)
		}
		runGitInDir(t, dir, "checkout", "-b", branch)
	}
	runGitInDir(t, dir, "config", "user.name", "Test User")
	runGitInDir(t, dir, "config", "user.email", "test@example.com")
}

func runGitInDir(t *testing.T, dir string, args ...string) {
	t.Helper()
	if err := runGitCommand(dir, args...); err != nil {
		t.Fatalf("git %s failed: %v", strings.Join(args, " "), err)
	}
}

func gitOutputInDir(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

func runGitCommand(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func createZipArchive(t *testing.T, path string, files map[string]string) {
	t.Helper()

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("Create(%q) error = %v", path, err)
	}
	defer file.Close()

	writer := zip.NewWriter(file)
	for name, content := range files {
		entryWriter, err := writer.Create(name)
		if err != nil {
			t.Fatalf("zip Create(%q) error = %v", name, err)
		}
		if _, err := entryWriter.Write([]byte(content)); err != nil {
			t.Fatalf("zip Write(%q) error = %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("zip Close() error = %v", err)
	}
}

func sevenZipFixturePath(t *testing.T, fileName string) string {
	t.Helper()

	modCache := strings.TrimSpace(os.Getenv("GOMODCACHE"))
	if modCache == "" {
		output, err := exec.Command("go", "env", "GOMODCACHE").CombinedOutput()
		if err != nil {
			t.Fatalf("go env GOMODCACHE failed: %v\n%s", err, output)
		}
		modCache = strings.TrimSpace(string(output))
	}
	return filepath.Join(modCache, "github.com", "bodgit", "sevenzip@v1.6.1", "testdata", fileName)
}

func copyFile(t *testing.T, sourcePath, destinationPath string) {
	t.Helper()

	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatalf("Open(%q) error = %v", sourcePath, err)
	}
	defer source.Close()

	destination, err := os.Create(destinationPath)
	if err != nil {
		t.Fatalf("Create(%q) error = %v", destinationPath, err)
	}
	defer destination.Close()

	if _, err := io.Copy(destination, source); err != nil {
		t.Fatalf("Copy(%q -> %q) error = %v", sourcePath, destinationPath, err)
	}
}

func assertPathExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected path %q to exist: %v", path, err)
	}
}

func assertPathNotExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected path %q to not exist, err = %v", path, err)
	}
}
