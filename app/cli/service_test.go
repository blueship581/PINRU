package cli

import (
	"reflect"
	"testing"
)

func TestValidatePermissionMode(t *testing.T) {
	if err := validatePermissionMode(""); err != nil {
		t.Fatalf("validatePermissionMode(empty) error = %v", err)
	}
	if err := validatePermissionMode("default"); err != nil {
		t.Fatalf("validatePermissionMode(default) error = %v", err)
	}
	if err := validatePermissionMode("acceptEdits"); err != nil {
		t.Fatalf("validatePermissionMode(acceptEdits) error = %v", err)
	}
	if err := validatePermissionMode("yolo"); err == nil {
		t.Fatalf("expected yolo mode to be rejected")
	}
	if err := validatePermissionMode("bypassPermissions"); err == nil {
		t.Fatalf("expected bypassPermissions mode to be rejected")
	}
}

func TestBuildClaudeArgsIncludesPermissionModeAndAdditionalDirs(t *testing.T) {
	args, err := buildClaudeArgs(StartClaudeRequest{
		Prompt:         "生成提示词",
		Model:          "claude-sonnet-4-6",
		PermissionMode: "acceptEdits",
		AdditionalDirs: []string{" /tmp/manuals ", "/tmp/manuals", "", "/tmp/skills"},
	})
	if err != nil {
		t.Fatalf("buildClaudeArgs() error = %v", err)
	}

	expected := []string{
		"-p", "生成提示词",
		"--model", "claude-sonnet-4-6",
		"--permission-mode", "acceptEdits",
		"--add-dir", "/tmp/manuals", "/tmp/skills",
	}
	if !reflect.DeepEqual(args, expected) {
		t.Fatalf("buildClaudeArgs() = %#v, want %#v", args, expected)
	}
}

func TestBuildClaudeArgsAddsPlanAllowedTools(t *testing.T) {
	args, err := buildClaudeArgs(StartClaudeRequest{
		Prompt: "规划一下",
		Mode:   "plan",
	})
	if err != nil {
		t.Fatalf("buildClaudeArgs() error = %v", err)
	}

	expectedSuffix := []string{"--allowedTools", "Read,Glob,Grep,WebFetch,WebSearch"}
	if len(args) < len(expectedSuffix) {
		t.Fatalf("buildClaudeArgs() = %#v, want suffix %#v", args, expectedSuffix)
	}
	if !reflect.DeepEqual(args[len(args)-len(expectedSuffix):], expectedSuffix) {
		t.Fatalf("buildClaudeArgs() suffix = %#v, want %#v", args[len(args)-len(expectedSuffix):], expectedSuffix)
	}
}
