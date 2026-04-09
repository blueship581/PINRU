package util

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	DefaultManagedSourceFolderName = "source"
	DefaultManagedTaskTypeName     = "feature迭代"
)

func ExpandTilde(path string) string {
	if path == "~" {
		if home, err := os.UserHomeDir(); err == nil {
			return home
		}
		return path
	}
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return path
}

func normalizeManagedFolderToken(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	cleaned := strings.NewReplacer("/", "-", "\\", "-").Replace(trimmed)
	return strings.Join(strings.Fields(cleaned), "")
}

func NormalizeManagedProjectFolderName(projectName string) string {
	trimmed := normalizeManagedFolderToken(projectName)
	if trimmed == "" {
		return DefaultManagedSourceFolderName
	}
	return trimmed
}

func NormalizeManagedTaskTypeFolderName(taskType string) string {
	trimmed := normalizeManagedFolderToken(taskType)
	if trimmed == "" {
		return DefaultManagedTaskTypeName
	}
	return strings.ToLower(trimmed)
}

func BuildManagedTaskFolderName(projectName, taskType string) string {
	return fmt.Sprintf("%s-%s", NormalizeManagedProjectFolderName(projectName), NormalizeManagedTaskTypeFolderName(taskType))
}

func BuildManagedTaskFolderPath(basePath, projectName, taskType string) string {
	trimmedBase := strings.TrimSpace(basePath)
	folderName := BuildManagedTaskFolderName(projectName, taskType)
	if trimmedBase == "" {
		return folderName
	}
	return filepath.Join(trimmedBase, folderName)
}

func BuildManagedSourceFolderName(projectID int64, taskType string) string {
	return fmt.Sprintf("%05d-%s", projectID, NormalizeManagedTaskTypeFolderName(taskType))
}

func BuildManagedSourceFolderPath(basePath string, projectID int64, taskType string) string {
	trimmedBase := strings.TrimSpace(basePath)
	folderName := BuildManagedSourceFolderName(projectID, taskType)
	if trimmedBase == "" {
		return folderName
	}
	return filepath.Join(trimmedBase, folderName)
}

func SamePath(a, b string) bool {
	trimmedA := strings.TrimSpace(a)
	trimmedB := strings.TrimSpace(b)
	if trimmedA == "" || trimmedB == "" {
		return trimmedA == trimmedB
	}
	return filepath.Clean(ExpandTilde(trimmedA)) == filepath.Clean(ExpandTilde(trimmedB))
}
