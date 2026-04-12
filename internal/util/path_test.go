package util

import "testing"

func TestNormalizePathCollapsesRepeatedSeparators(t *testing.T) {
	got := NormalizePath("/Users/gaobo/repositories/gitlab//////project/0408/solo/label/01808/comparison")
	want := "/Users/gaobo/repositories/gitlab/project/0408/solo/label/01808/comparison"
	if got != want {
		t.Fatalf("NormalizePath() = %q, want %q", got, want)
	}
}
