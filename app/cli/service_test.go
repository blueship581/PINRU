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
	if err := validatePermissionMode("yolo"); err != nil {
		t.Fatalf("validatePermissionMode(yolo) error = %v", err)
	}
	if err := validatePermissionMode("bypassPermissions"); err != nil {
		t.Fatalf("validatePermissionMode(bypassPermissions) error = %v", err)
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

func TestBuildClaudeArgsDefaultsToDangerousSkipPermissions(t *testing.T) {
	args, err := buildClaudeArgs(StartClaudeRequest{
		Prompt: "生成提示词",
		Model:  "claude-sonnet-4-6",
	})
	if err != nil {
		t.Fatalf("buildClaudeArgs() error = %v", err)
	}

	expected := []string{
		"-p", "生成提示词",
		"--model", "claude-sonnet-4-6",
		"--dangerously-skip-permissions",
	}
	if !reflect.DeepEqual(args, expected) {
		t.Fatalf("buildClaudeArgs() = %#v, want %#v", args, expected)
	}
}

func TestBuildClaudeArgsMapsYoloToBypassPermissions(t *testing.T) {
	args, err := buildClaudeArgs(StartClaudeRequest{
		Prompt:         "生成提示词",
		PermissionMode: "yolo",
	})
	if err != nil {
		t.Fatalf("buildClaudeArgs() error = %v", err)
	}

	expected := []string{
		"-p", "生成提示词",
		"--permission-mode", "bypassPermissions",
		"--dangerously-skip-permissions",
	}
	if !reflect.DeepEqual(args, expected) {
		t.Fatalf("buildClaudeArgs() = %#v, want %#v", args, expected)
	}
}

func TestApplyEnvOverrides(t *testing.T) {
	base := []string{
		"PATH=/usr/bin:/bin",
		"ANTHROPIC_MODEL=claude-opus-4-6",
		"HOME=/Users/test",
	}

	// Override ANTHROPIC_MODEL, add a new key
	result := applyEnvOverrides(base, map[string]string{
		"ANTHROPIC_MODEL": "claude-sonnet-4-6",
		"EXTRA_VAR":       "hello",
	})

	env := make(map[string]string, len(result))
	for _, entry := range result {
		idx := len(entry)
		for i, c := range entry {
			if c == '=' {
				idx = i
				break
			}
		}
		env[entry[:idx]] = entry[idx+1:]
	}

	if env["ANTHROPIC_MODEL"] != "claude-sonnet-4-6" {
		t.Errorf("ANTHROPIC_MODEL = %q, want claude-sonnet-4-6", env["ANTHROPIC_MODEL"])
	}
	if env["PATH"] != "/usr/bin:/bin" {
		t.Errorf("PATH = %q, want /usr/bin:/bin", env["PATH"])
	}
	if env["HOME"] != "/Users/test" {
		t.Errorf("HOME = %q, want /Users/test", env["HOME"])
	}
	if env["EXTRA_VAR"] != "hello" {
		t.Errorf("EXTRA_VAR = %q, want hello", env["EXTRA_VAR"])
	}
	// Ensure ANTHROPIC_MODEL appears only once
	count := 0
	for _, entry := range result {
		if len(entry) >= 14 && entry[:14] == "ANTHROPIC_MODE" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("ANTHROPIC_MODEL appears %d times in env, want 1", count)
	}
}
