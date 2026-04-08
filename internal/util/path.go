package util

import (
	"os"
	"path/filepath"
	"strings"
)

const DefaultManagedSourceFolderName = "source"

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

func NormalizeManagedSourceFolderName(projectName string) string {
	trimmed := strings.TrimSpace(projectName)
	if trimmed == "" {
		return DefaultManagedSourceFolderName
	}
	return strings.NewReplacer("/", "-", "\\", "-").Replace(trimmed)
}

func BuildManagedSourceFolderPath(basePath, projectName string) string {
	trimmedBase := strings.TrimSpace(basePath)
	folderName := NormalizeManagedSourceFolderName(projectName)
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
