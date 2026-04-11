package prompt

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

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
		return fmt.Errorf("写入提示词文件失败: %w", err)
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
		return nil, fmt.Errorf("未找到任务: %s", taskID)
	}
	return task, nil
}

// SyncPromptArtifactIfPresent updates the artifact file only when it already
// exists on disk, leaving directories without an artifact file untouched.
func SyncPromptArtifactIfPresent(localPath *string, promptText string) error {
	if localPath == nil {
		return nil
	}

	workDir := strings.TrimSpace(*localPath)
	if workDir == "" {
		return nil
	}

	workDir = util.ExpandTilde(workDir)
	path := PromptArtifactPath(workDir)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("读取提示词文件信息失败: %w", err)
	}

	return WritePromptArtifact(workDir, promptText)
}

// BestEffortSyncTaskPromptArtifact syncs the prompt artifact for task on a
// best-effort basis, logging any errors rather than propagating them.
func BestEffortSyncTaskPromptArtifact(task *store.Task, promptText string) {
	if task == nil {
		return
	}
	if err := SyncPromptArtifactIfPresent(task.LocalPath, promptText); err != nil {
		log.Printf("sync task prompt artifact failed for %s: %v", task.ID, err)
	}
}
