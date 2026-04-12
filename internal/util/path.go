package util

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
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

func NormalizePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return ""
	}
	return filepath.Clean(ExpandTilde(trimmed))
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

func appendManagedFolderSequence(folderName string, sequence int) string {
	if sequence <= 0 {
		return folderName
	}
	return fmt.Sprintf("%s-%d", folderName, sequence)
}

func ParseManagedFolderSequence(name, baseName string) (int, bool) {
	trimmedName := strings.TrimSpace(name)
	trimmedBase := strings.TrimSpace(baseName)
	if trimmedName == "" || trimmedBase == "" {
		return 0, false
	}
	if trimmedName == trimmedBase {
		return 0, true
	}

	prefix := trimmedBase + "-"
	if !strings.HasPrefix(trimmedName, prefix) {
		return 0, false
	}

	sequence, err := strconv.Atoi(strings.TrimPrefix(trimmedName, prefix))
	if err != nil || sequence <= 0 {
		return 0, false
	}
	return sequence, true
}

func BuildManagedTaskFolderNameWithSequence(projectName, taskType string, sequence int) string {
	return appendManagedFolderSequence(BuildManagedTaskFolderName(projectName, taskType), sequence)
}

func BuildManagedTaskFolderPath(basePath, projectName, taskType string) string {
	return BuildManagedTaskFolderPathWithSequence(basePath, projectName, taskType, 0)
}

func BuildManagedTaskFolderPathWithSequence(basePath, projectName, taskType string, sequence int) string {
	trimmedBase := strings.TrimSpace(basePath)
	folderName := BuildManagedTaskFolderNameWithSequence(projectName, taskType, sequence)
	if trimmedBase == "" {
		return folderName
	}
	return filepath.Join(trimmedBase, folderName)
}

func BuildManagedSourceFolderName(projectID int64, taskType string) string {
	return fmt.Sprintf("%05d-%s", projectID, NormalizeManagedTaskTypeFolderName(taskType))
}

func BuildManagedSourceFolderNameWithSequence(projectID int64, taskType string, sequence int) string {
	return appendManagedFolderSequence(BuildManagedSourceFolderName(projectID, taskType), sequence)
}

func BuildManagedSourceFolderPath(basePath string, projectID int64, taskType string) string {
	return BuildManagedSourceFolderPathWithSequence(basePath, projectID, taskType, 0)
}

func BuildManagedSourceFolderPathWithSequence(basePath string, projectID int64, taskType string, sequence int) string {
	trimmedBase := strings.TrimSpace(basePath)
	folderName := BuildManagedSourceFolderNameWithSequence(projectID, taskType, sequence)
	if trimmedBase == "" {
		return folderName
	}
	return filepath.Join(trimmedBase, folderName)
}

func ParseManagedTaskFolderSequence(name, projectName, taskType string) (int, bool) {
	return ParseManagedFolderSequence(name, BuildManagedTaskFolderName(projectName, taskType))
}

func ParseManagedSourceFolderSequence(name string, projectID int64, taskType string) (int, bool) {
	return ParseManagedFolderSequence(name, BuildManagedSourceFolderName(projectID, taskType))
}

// PinruManualDir returns the platform-appropriate directory for PINRU's
// bundled execution manuals. Mirrors the DB location (~/.pinru/).
func PinruManualDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".pinru", "manuals")
}

// DefaultTraeWorkspaceStoragePath returns the platform-default Trae CN
// workspaceStorage directory relative to the user's home. Returns empty
// string when the home directory cannot be determined.
func DefaultTraeWorkspaceStoragePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	var rel string
	switch runtime.GOOS {
	case "windows":
		rel = filepath.Join("AppData", "Roaming", "Trae CN", "User", "workspaceStorage")
	default: // darwin / linux
		rel = filepath.Join("Library", "Application Support", "Trae CN", "User", "workspaceStorage")
	}
	return filepath.Join(home, rel)
}

// DefaultTraeLogsPath returns the platform-default Trae CN logs directory
// relative to the user's home. Returns empty string when the home directory
// cannot be determined.
func DefaultTraeLogsPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	var rel string
	switch runtime.GOOS {
	case "windows":
		rel = filepath.Join("AppData", "Roaming", "Trae CN", "logs")
	default: // darwin / linux
		rel = filepath.Join("Library", "Application Support", "Trae CN", "logs")
	}
	return filepath.Join(home, rel)
}

func SamePath(a, b string) bool {
	trimmedA := strings.TrimSpace(a)
	trimmedB := strings.TrimSpace(b)
	if trimmedA == "" || trimmedB == "" {
		return trimmedA == trimmedB
	}
	return NormalizePath(trimmedA) == NormalizePath(trimmedB)
}

func IsWithinBasePath(basePath, targetPath string) bool {
	trimmedBase := strings.TrimSpace(basePath)
	trimmedTarget := strings.TrimSpace(targetPath)
	if trimmedBase == "" || trimmedTarget == "" {
		return false
	}

	base := NormalizePath(trimmedBase)
	target := NormalizePath(trimmedTarget)
	if base == target {
		return true
	}

	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	if rel == "." {
		return true
	}

	return rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator))
}
