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
