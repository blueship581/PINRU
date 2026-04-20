package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNormalizePathCollapsesRepeatedSeparators(t *testing.T) {
	sep := string(filepath.Separator)
	base := os.TempDir()
	input := base + sep + sep + sep + "pinru" + sep + sep + sep + "project" + sep + sep + "label" + sep + sep + "01808"
	want := filepath.Join(base, "pinru", "project", "label", "01808")
	got := NormalizePath(input)
	if got != want {
		t.Fatalf("NormalizePath() = %q, want %q", got, want)
	}
}

func TestManagedFolderSequenceHelpers(t *testing.T) {
	taskPath := BuildManagedTaskFolderPathWithSequence("/tmp/workspace", "label-01849", "Bug修复", 2)
	if want := filepath.Join("/tmp/workspace", "label-01849-bug修复-2"); taskPath != want {
		t.Fatalf("BuildManagedTaskFolderPathWithSequence() = %q, want %q", taskPath, want)
	}

	sourcePath := BuildManagedSourceFolderPathWithSequence(taskPath, 1849, "Bug修复", 2)
	if want := filepath.Join("/tmp/workspace", "label-01849-bug修复-2", "label-01849-bug修复-2"); sourcePath != want {
		t.Fatalf("BuildManagedSourceFolderPathWithSequence() = %q, want %q", sourcePath, want)
	}
	if got := BuildManagedSourceFolderNameFromTaskPath(taskPath); got != "label-01849-bug修复-2" {
		t.Fatalf("BuildManagedSourceFolderNameFromTaskPath() = %q, want %q", got, "label-01849-bug修复-2")
	}

	if sequence, ok := ParseManagedTaskFolderSequence("label-01849-bug修复-2", "label-01849", "Bug修复"); !ok || sequence != 2 {
		t.Fatalf("ParseManagedTaskFolderSequence() = (%d, %v), want (2, true)", sequence, ok)
	}
	if sequence, ok := ParseManagedSourceFolderSequence("01849-bug修复-2", 1849, "Bug修复"); !ok || sequence != 2 {
		t.Fatalf("ParseManagedSourceFolderSequence() = (%d, %v), want (2, true)", sequence, ok)
	}
	if sequence, ok := ParseManagedTaskFolderSequence("label-01849-bug修复", "label-01849", "Bug修复"); !ok || sequence != 0 {
		t.Fatalf("ParseManagedTaskFolderSequence(base) = (%d, %v), want (0, true)", sequence, ok)
	}
}
