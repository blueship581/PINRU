package task

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

type TaskReadme struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

var readmeCandidateNames = []string{
	"README.md",
	"README.markdown",
	"README.mdx",
	"README",
}

func (s *TaskService) GetTaskReadme(taskID string) (*TaskReadme, error) {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" {
		return nil, errors.New(errs.MsgTaskRequired)
	}

	task, err := s.store.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, taskID)
	}

	modelRuns, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return nil, err
	}

	sourcePath, err := s.resolveTaskReadmeSourcePath(task, modelRuns)
	if err != nil {
		return nil, err
	}
	if sourcePath == "" {
		return nil, nil
	}

	entries, err := os.ReadDir(util.ExpandTilde(sourcePath))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	entryByLowerName := make(map[string]os.DirEntry, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		entryByLowerName[strings.ToLower(entry.Name())] = entry
	}

	for _, candidateName := range readmeCandidateNames {
		entry, ok := entryByLowerName[strings.ToLower(candidateName)]
		if !ok {
			continue
		}

		readmePath := util.NormalizePath(filepath.Join(sourcePath, entry.Name()))
		content, err := os.ReadFile(util.ExpandTilde(readmePath))
		if err != nil {
			return nil, err
		}
		normalizedContent := strings.ReplaceAll(string(content), "\r\n", "\n")
		normalizedContent = strings.ReplaceAll(normalizedContent, "\r", "\n")
		return &TaskReadme{
			Path:    readmePath,
			Content: normalizedContent,
		}, nil
	}

	return nil, nil
}

func (s *TaskService) resolveTaskReadmeSourcePath(task *store.Task, modelRuns []store.ModelRun) (string, error) {
	if task == nil {
		return "", nil
	}

	sourceModelName, err := s.resolveTaskSourceModelName(task)
	if err != nil {
		return "", err
	}

	for _, run := range modelRuns {
		if !(isOriginModelName(run.ModelName) || isSourceModelFolder(run.ModelName, sourceModelName)) {
			continue
		}
		if pathValue, ok := normalizeExistingDirectory(run.LocalPath); ok {
			return pathValue, nil
		}
	}

	if task.LocalPath == nil || strings.TrimSpace(*task.LocalPath) == "" {
		return "", nil
	}

	taskBasePath := util.NormalizePath(*task.LocalPath)
	entries, err := os.ReadDir(util.ExpandTilde(taskBasePath))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		entryName := strings.TrimSpace(entry.Name())
		if entryName == "" {
			continue
		}
		if strings.EqualFold(entryName, util.BuildManagedSourceFolderNameFromTaskPath(taskBasePath)) {
			return util.NormalizePath(filepath.Join(taskBasePath, entryName)), nil
		}
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		entryName := strings.TrimSpace(entry.Name())
		if entryName == "" {
			continue
		}
		if _, ok := util.ParseManagedSourceFolderSequence(entryName, task.GitLabProjectID, task.TaskType); ok {
			return util.NormalizePath(filepath.Join(taskBasePath, entryName)), nil
		}
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		entryName := strings.TrimSpace(entry.Name())
		if entryName == "" {
			continue
		}
		if isSourceModelFolder(entryName, sourceModelName) {
			return util.NormalizePath(filepath.Join(taskBasePath, entryName)), nil
		}
	}

	return "", nil
}
