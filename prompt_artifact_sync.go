package main

import (
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
)

type promptTaskGetter interface {
	GetTask(id string) (*store.Task, error)
}

func loadTaskForPromptSync(taskStore promptTaskGetter, taskID string) (*store.Task, error) {
	task, err := taskStore.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("未找到任务: %s", taskID)
	}
	return task, nil
}

func syncPromptArtifactIfPresent(localPath *string, promptText string) error {
	if localPath == nil {
		return nil
	}

	workDir := strings.TrimSpace(*localPath)
	if workDir == "" {
		return nil
	}

	workDir = util.ExpandTilde(workDir)
	path := promptArtifactPath(workDir)
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("读取提示词文件信息失败: %w", err)
	}

	return writePromptArtifact(workDir, promptText)
}

func bestEffortSyncTaskPromptArtifact(task *store.Task, promptText string) {
	if task == nil {
		return
	}
	if err := syncPromptArtifactIfPresent(task.LocalPath, promptText); err != nil {
		log.Printf("sync task prompt artifact failed for %s: %v", task.ID, err)
	}
}
