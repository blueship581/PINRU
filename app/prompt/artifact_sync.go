package prompt

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

type promptTaskGetter interface {
	GetTask(id string) (*store.Task, error)
}

// PromptArtifactPath returns the canonical path of the prompt artifact file
// inside the given work directory.
func PromptArtifactPath(workDir string) string {
	return filepath.Join(workDir, "任务提示词.md")
}

// WritePromptArtifact writes the prompt text to the artifact file in workDir.
func WritePromptArtifact(workDir, promptText string) error {
	path := PromptArtifactPath(workDir)
	if err := os.WriteFile(path, []byte(strings.TrimSpace(promptText)+"\n"), 0o644); err != nil {
		return fmt.Errorf(errs.FmtPromptWriteFile, err)
	}
	return nil
}

// LoadTaskForPromptSync fetches the task and returns an error if it doesn't exist.
func LoadTaskForPromptSync(taskStore promptTaskGetter, taskID string) (*store.Task, error) {
	task, err := taskStore.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf(errs.FmtTaskNotFound, taskID)
	}
	return task, nil
}

// SyncPromptArtifact writes the prompt artifact into the task work directory.
// The artifact file is created when it does not already exist.
func SyncPromptArtifact(localPath *string, promptText string) error {
	if localPath == nil {
		return nil
	}

	workDir := util.NormalizePath(*localPath)
	if workDir == "" {
		return nil
	}

	info, err := os.Stat(workDir)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf(errs.FmtTaskDirNotExist, workDir)
		}
		return fmt.Errorf(errs.FmtReadTaskDirInfoFail, err)
	}
	if !info.IsDir() {
		return fmt.Errorf(errs.FmtTaskDirNotFolder, workDir)
	}

	return WritePromptArtifact(workDir, promptText)
}

// BestEffortSyncTaskPromptArtifact syncs the prompt artifact for task on a
// best-effort basis, logging any errors rather than propagating them.
func BestEffortSyncTaskPromptArtifact(task *store.Task, promptText string) {
	if task == nil {
		return
	}
	if err := SyncPromptArtifact(task.LocalPath, promptText); err != nil {
		slog.Error("sync task prompt artifact failed", "task_id", task.ID, "error", err)
	}
}
