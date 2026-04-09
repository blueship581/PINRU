package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	gl "github.com/blueship581/pinru/internal/gitlab"
	"github.com/blueship581/pinru/internal/gitops"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type GitService struct {
	store *store.Store
}

type GitLabProjectLookupResult struct {
	ProjectRef string      `json:"projectRef"`
	Project    *gl.Project `json:"project"`
	Error      *string     `json:"error"`
}

type NormalizeManagedSourceFolderDetail struct {
	TaskID          string `json:"taskId"`
	ProjectName     string `json:"projectName"`
	SourceModelName string `json:"sourceModelName"`
	PreviousPath    string `json:"previousPath"`
	CurrentPath     string `json:"currentPath"`
	Status          string `json:"status"`
	Message         string `json:"message"`
}

type NormalizeManagedSourceFoldersResult struct {
	ProjectID    string                               `json:"projectId"`
	ProjectName  string                               `json:"projectName"`
	TotalTasks   int                                  `json:"totalTasks"`
	RenamedCount int                                  `json:"renamedCount"`
	UpdatedCount int                                  `json:"updatedCount"`
	SkippedCount int                                  `json:"skippedCount"`
	ErrorCount   int                                  `json:"errorCount"`
	Details      []NormalizeManagedSourceFolderDetail `json:"details"`
}

type DirectoryInspectionResult struct {
	Path    string `json:"path"`
	Name    string `json:"name"`
	Exists  bool   `json:"exists"`
	IsDir   bool   `json:"isDir"`
	IsEmpty bool   `json:"isEmpty"`
}

func (s *GitService) FetchGitLabProject(projectRef, url, token string) (*gl.Project, error) {
	return gl.FetchProject(projectRef, url, token)
}

func (s *GitService) FetchGitLabProjects(projectRefs []string, url, token string) []GitLabProjectLookupResult {
	results := make([]GitLabProjectLookupResult, len(projectRefs))
	sem := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for i, ref := range projectRefs {
		wg.Add(1)
		go func(idx int, r string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			p, err := gl.FetchProject(r, url, token)
			result := GitLabProjectLookupResult{ProjectRef: r, Project: p}
			if err != nil {
				errStr := err.Error()
				result.Error = &errStr
			}
			results[idx] = result
		}(i, ref)
	}
	wg.Wait()
	return results
}

func (s *GitService) CloneProject(cloneURL, path, username, token string) error {
	app := application.Get()
	return gitops.CloneWithProgress(cloneURL, path, username, token, func(msg string) {
		app.Event.Emit("clone-progress", msg)
	})
}

func (s *GitService) DownloadGitLabProject(projectID int64, url, token, destination string, sha *string) error {
	return gl.DownloadArchive(projectID, url, token, destination, sha)
}

func (s *GitService) CopyProjectDirectory(sourcePath, destinationPath string) error {
	return gitops.CopyProjectDirectory(sourcePath, destinationPath)
}

func (s *GitService) CheckPathsExist(paths []string) []string {
	return gitops.CheckPathsExist(paths)
}

func (s *GitService) InspectDirectory(path string) (*DirectoryInspectionResult, error) {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return nil, fmt.Errorf("目录不能为空")
	}

	expanded := filepath.Clean(util.ExpandTilde(trimmed))
	result := &DirectoryInspectionResult{
		Path: expanded,
		Name: filepath.Base(expanded),
	}

	info, err := os.Stat(expanded)
	if err != nil {
		if os.IsNotExist(err) {
			return result, nil
		}
		return nil, err
	}

	result.Exists = true
	result.IsDir = info.IsDir()
	if !info.IsDir() {
		return result, nil
	}

	entries, err := os.ReadDir(expanded)
	if err != nil {
		return nil, err
	}
	result.IsEmpty = len(entries) == 0
	return result, nil
}

func (s *GitService) NormalizeManagedSourceFolders(projectID string) (*NormalizeManagedSourceFoldersResult, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, fmt.Errorf("项目不能为空")
	}

	project, err := s.store.GetProject(projectID)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, fmt.Errorf("未找到项目: %s", projectID)
	}

	tasks, err := s.store.ListTasks(&projectID)
	if err != nil {
		return nil, err
	}

	sourceModelName := strings.TrimSpace(project.SourceModelFolder)
	if sourceModelName == "" {
		sourceModelName = "ORIGIN"
	}

	result := &NormalizeManagedSourceFoldersResult{
		ProjectID:   project.ID,
		ProjectName: project.Name,
		TotalTasks:  len(tasks),
		Details:     make([]NormalizeManagedSourceFolderDetail, 0, len(tasks)),
	}

	for _, task := range tasks {
		detail := NormalizeManagedSourceFolderDetail{
			TaskID:      task.ID,
			ProjectName: task.ProjectName,
		}

		if err := s.normalizeManagedSourceFolder(task, sourceModelName, &detail); err != nil {
			detail.Status = "error"
			detail.Message = err.Error()
		}

		switch detail.Status {
		case "renamed":
			result.RenamedCount++
		case "updated":
			result.UpdatedCount++
		case "skipped":
			result.SkippedCount++
		default:
			result.ErrorCount++
		}

		result.Details = append(result.Details, detail)
	}

	return result, nil
}

func (s *GitService) normalizeManagedSourceFolder(task store.Task, preferredSourceModel string, detail *NormalizeManagedSourceFolderDetail) error {
	runs, err := s.store.ListModelRuns(task.ID)
	if err != nil {
		return err
	}

	sourceRun := pickSourceRun(runs, preferredSourceModel)
	if sourceRun != nil {
		detail.SourceModelName = sourceRun.ModelName
	}

	basePath := ""
	if task.LocalPath != nil && strings.TrimSpace(*task.LocalPath) != "" {
		basePath = strings.TrimSpace(*task.LocalPath)
	}
	if basePath == "" && sourceRun != nil && sourceRun.LocalPath != nil && strings.TrimSpace(*sourceRun.LocalPath) != "" {
		basePath = filepath.Dir(strings.TrimSpace(*sourceRun.LocalPath))
	}
	if basePath == "" {
		detail.Status = "skipped"
		detail.Message = "缺少任务工作目录"
		if sourceRun == nil {
			detail.Message = joinNormalizeMessages(detail.Message, "未找到源码模型记录")
		}
		return nil
	}

	currentPath := ""
	if sourceRun != nil && sourceRun.LocalPath != nil {
		currentPath = strings.TrimSpace(*sourceRun.LocalPath)
		detail.PreviousPath = currentPath
	}

	baseRoot := filepath.Dir(basePath)
	desiredBasePath := util.BuildManagedTaskFolderPath(baseRoot, task.ProjectName, task.TaskType)
	baseStatus, baseMessage, err := normalizeManagedDirectoryOnDisk(basePath, desiredBasePath, "任务目录")
	if err != nil {
		return err
	}

	if !util.SamePath(basePath, desiredBasePath) {
		if err := s.rewriteModelRunBasePaths(task.ID, runs, basePath, desiredBasePath); err != nil {
			return err
		}
		currentPath = rewriteManagedPathBase(currentPath, basePath, desiredBasePath)
	}

	if task.LocalPath == nil || !util.SamePath(*task.LocalPath, desiredBasePath) {
		desiredBase := desiredBasePath
		if err := s.store.UpdateTaskLocalPath(task.ID, &desiredBase); err != nil {
			return err
		}
		if baseStatus == "skipped" {
			baseStatus = "updated"
			if baseMessage == "" {
				baseMessage = "已回写任务工作目录"
			}
		}
	}

	promptStatus, promptMessage, err := s.syncTaskPromptArtifact(task, desiredBasePath)
	if err != nil {
		return err
	}

	if sourceRun == nil {
		detail.Status = mergeNormalizeStatuses(baseStatus, promptStatus)
		detail.Message = joinNormalizeMessages(baseMessage, promptMessage, "未找到源码模型记录")
		if detail.Message == "" {
			switch detail.Status {
			case "renamed":
				detail.Message = "已完成目录归一"
			case "updated":
				detail.Message = "已完成目录路径回写"
			default:
				detail.Message = "未找到源码模型记录"
			}
		}
		return nil
	}

	desiredPath := util.BuildManagedSourceFolderPath(desiredBasePath, task.GitLabProjectID, task.TaskType)
	detail.CurrentPath = desiredPath

	status, message, err := normalizeManagedDirectoryOnDisk(currentPath, desiredPath, "源码目录")
	if err != nil {
		return err
	}

	if currentPath == "" || !util.SamePath(currentPath, desiredPath) {
		desired := desiredPath
		if err := s.store.UpdateModelRunLocalPath(task.ID, sourceRun.ModelName, &desired); err != nil {
			return err
		}
	}

	detail.Status = mergeNormalizeStatuses(baseStatus, promptStatus, status)
	detail.Message = joinNormalizeMessages(baseMessage, promptMessage, message)
	if detail.Message == "" {
		switch detail.Status {
		case "renamed":
			detail.Message = "已完成目录归一"
		case "updated":
			detail.Message = "已完成目录路径回写"
		case "skipped":
			detail.Message = "目录已符合当前规则"
		}
	}

	return nil
}

func (s *GitService) syncTaskPromptArtifact(task store.Task, taskBasePath string) (string, string, error) {
	basePath := strings.TrimSpace(taskBasePath)
	if basePath == "" {
		return "", "", nil
	}

	promptPath := promptArtifactPath(util.ExpandTilde(basePath))
	content, err := os.ReadFile(promptPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", "", nil
		}
		return "", "", fmt.Errorf("读取任务提示词失败: %w", err)
	}

	promptText := strings.TrimSpace(string(content))
	if promptText == "" {
		return "", "任务提示词文件为空，已跳过同步", nil
	}
	if !taskPromptNeedsSync(task, promptText) {
		return "", "", nil
	}

	if err := s.store.SyncTaskPromptFromArtifact(task.ID, promptText); err != nil {
		return "", "", fmt.Errorf("同步任务提示词失败: %w", err)
	}
	return "updated", "已同步任务提示词", nil
}

func taskPromptNeedsSync(task store.Task, promptText string) bool {
	if task.PromptText == nil || strings.TrimSpace(*task.PromptText) != promptText {
		return true
	}
	if task.PromptGenerationStatus != "done" || task.PromptGenerationError != nil {
		return true
	}
	return task.Status != "PromptReady" && task.Status != "Submitted"
}

func normalizeManagedDirectoryOnDisk(currentPath, desiredPath, directoryLabel string) (string, string, error) {
	desiredPath = strings.TrimSpace(desiredPath)
	if desiredPath == "" {
		return "", "", fmt.Errorf("目标目录不能为空")
	}

	currentPath = strings.TrimSpace(currentPath)
	if util.SamePath(currentPath, desiredPath) {
		if managedDirectoryExists(desiredPath) {
			return "skipped", "", nil
		}
		return "", "", fmt.Errorf("%s不存在: %s", directoryLabel, desiredPath)
	}

	currentExists := managedDirectoryExists(currentPath)
	desiredExists := managedDirectoryExists(desiredPath)

	switch {
	case currentPath == "":
		if desiredExists {
			return "updated", "已按目标目录回写路径", nil
		}
		return "", "", fmt.Errorf("未找到可归一的%s", directoryLabel)
	case currentExists && desiredExists:
		return "", "", fmt.Errorf("目标目录已存在，无法归一: %s", desiredPath)
	case currentExists && !desiredExists:
		if err := os.MkdirAll(filepath.Dir(util.ExpandTilde(desiredPath)), 0o755); err != nil {
			return "", "", err
		}
		if err := os.Rename(util.ExpandTilde(currentPath), util.ExpandTilde(desiredPath)); err != nil {
			return "", "", err
		}
		return "renamed", fmt.Sprintf("%s已重命名为 %s", directoryLabel, filepath.Base(util.ExpandTilde(desiredPath))), nil
	case !currentExists && desiredExists:
		return "updated", "目标目录已存在，已回写数据库路径", nil
	default:
		return "", "", fmt.Errorf("%s不存在: %s", directoryLabel, currentPath)
	}
}

func (s *GitService) rewriteModelRunBasePaths(taskID string, runs []store.ModelRun, previousBasePath, currentBasePath string) error {
	for _, run := range runs {
		if run.LocalPath == nil {
			continue
		}

		rewrittenPath := rewriteManagedPathBase(strings.TrimSpace(*run.LocalPath), previousBasePath, currentBasePath)
		if rewrittenPath == "" || util.SamePath(rewrittenPath, strings.TrimSpace(*run.LocalPath)) {
			continue
		}

		nextPath := rewrittenPath
		if err := s.store.UpdateModelRunLocalPath(taskID, run.ModelName, &nextPath); err != nil {
			return err
		}
	}

	return nil
}

func rewriteManagedPathBase(path, previousBasePath, currentBasePath string) string {
	trimmedPath := strings.TrimSpace(path)
	trimmedPreviousBase := strings.TrimSpace(previousBasePath)
	trimmedCurrentBase := strings.TrimSpace(currentBasePath)
	if trimmedPath == "" || trimmedPreviousBase == "" || trimmedCurrentBase == "" || util.SamePath(trimmedPreviousBase, trimmedCurrentBase) {
		return trimmedPath
	}

	expandedPreviousBase := util.ExpandTilde(trimmedPreviousBase)
	expandedPath := util.ExpandTilde(trimmedPath)
	rel, err := filepath.Rel(expandedPreviousBase, expandedPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return trimmedPath
	}
	if rel == "." {
		return trimmedCurrentBase
	}
	return filepath.Join(trimmedCurrentBase, rel)
}

func mergeNormalizeStatuses(statuses ...string) string {
	result := "skipped"
	for _, status := range statuses {
		switch status {
		case "renamed":
			return "renamed"
		case "updated":
			result = "updated"
		}
	}
	return result
}

func joinNormalizeMessages(messages ...string) string {
	nonEmpty := make([]string, 0, len(messages))
	for _, message := range messages {
		if trimmed := strings.TrimSpace(message); trimmed != "" {
			nonEmpty = append(nonEmpty, trimmed)
		}
	}
	return strings.Join(nonEmpty, "；")
}

func pickSourceRun(runs []store.ModelRun, preferredSourceModel string) *store.ModelRun {
	preferred := strings.TrimSpace(preferredSourceModel)
	if preferred == "" {
		preferred = "ORIGIN"
	}

	for i := range runs {
		if strings.EqualFold(runs[i].ModelName, preferred) {
			return &runs[i]
		}
	}
	for i := range runs {
		if runHasGitMetadata(runs[i]) {
			return &runs[i]
		}
	}
	for i := range runs {
		if strings.EqualFold(runs[i].ModelName, "ORIGIN") {
			return &runs[i]
		}
	}
	if len(runs) == 0 {
		return nil
	}
	return &runs[0]
}

func runHasGitMetadata(run store.ModelRun) bool {
	if run.LocalPath == nil || strings.TrimSpace(*run.LocalPath) == "" {
		return false
	}
	_, err := os.Stat(filepath.Join(util.ExpandTilde(*run.LocalPath), ".git"))
	return err == nil
}

func managedDirectoryExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(util.ExpandTilde(path))
	return err == nil && info.IsDir()
}
