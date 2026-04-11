package task

import "testing"

func TestBestTraeWorkspacePathMatchMatchesCrossRootPeerModel(t *testing.T) {
	workspacePath := "/Users/alice/workspaces/review/label-01849-comparison/cotv21-pro"
	targetPaths := []string{
		"/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-comparison/cotv21-pro",
	}

	matchedPath, matchKind, matchScore, ok := bestTraeWorkspacePathMatch(workspacePath, targetPaths)
	if !ok {
		t.Fatalf("expected cross-root model path to match")
	}
	if matchedPath != targetPaths[0] {
		t.Fatalf("matchedPath = %q, want %q", matchedPath, targetPaths[0])
	}
	if matchKind != "peer_model" {
		t.Fatalf("matchKind = %q, want peer_model", matchKind)
	}
	if matchScore != 170 {
		t.Fatalf("matchScore = %d, want 170", matchScore)
	}
}

func TestBestTraeWorkspacePathMatchMatchesCrossRootPeerTask(t *testing.T) {
	workspacePath := "/Users/alice/workspaces/review/label-01849-bug修复"
	targetPaths := []string{
		"/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-comparison/cotv21-pro",
	}

	matchedPath, matchKind, matchScore, ok := bestTraeWorkspacePathMatch(workspacePath, targetPaths)
	if !ok {
		t.Fatalf("expected cross-root task path to match")
	}
	if matchedPath != targetPaths[0] {
		t.Fatalf("matchedPath = %q, want %q", matchedPath, targetPaths[0])
	}
	if matchKind != "peer_task" {
		t.Fatalf("matchKind = %q, want peer_task", matchKind)
	}
	if matchScore != 150 {
		t.Fatalf("matchScore = %d, want 150", matchScore)
	}
}
