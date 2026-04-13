package cli

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
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

func TestPgCodeReviewSchemaDisallowsAdditionalProperties(t *testing.T) {
	var schema map[string]interface{}
	if err := json.Unmarshal(pgCodeReviewSchema, &schema); err != nil {
		t.Fatalf("json.Unmarshal(pgCodeReviewSchema) error = %v", err)
	}

	value, ok := schema["additionalProperties"]
	if !ok {
		t.Fatalf("schema missing additionalProperties: %v", schema)
	}
	if allowed, ok := value.(bool); !ok || allowed {
		t.Fatalf("schema additionalProperties = %#v, want false", value)
	}
}

func TestRunCodexReviewIncludesRecentCliOutputInError(t *testing.T) {
	repoDir := t.TempDir()
	scriptPath := filepath.Join(t.TempDir(), "codex")
	script := "#!/bin/sh\n" +
		"echo 'ERROR: invalid schema' >&2\n" +
		"echo 'ERROR: additionalProperties must be false' >&2\n" +
		"exit 1\n"
	if err := os.WriteFile(scriptPath, []byte(script), 0o755); err != nil {
		t.Fatalf("os.WriteFile(scriptPath) error = %v", err)
	}

	svc := NewWithResolver(func(name string) (string, error) {
		if name != "codex" {
			t.Fatalf("unexpected CLI lookup: %s", name)
		}
		return scriptPath, nil
	})

	_, err := svc.RunCodexReview(context.Background(), repoDir, nil)
	if err == nil {
		t.Fatalf("RunCodexReview() error = nil, want failure")
	}
	if !strings.Contains(err.Error(), "invalid schema") {
		t.Fatalf("RunCodexReview() error = %q, want invalid schema detail", err.Error())
	}
	if !strings.Contains(err.Error(), "additionalProperties must be false") {
		t.Fatalf("RunCodexReview() error = %q, want stderr tail", err.Error())
	}
}

func TestBuildCodexReviewPromptIncludesEvidenceGuardrails(t *testing.T) {
	prompt := buildCodexReviewPrompt(&pgCodeProjectContext{
		ResolvedPath:     "/tmp/demo",
		PromptCandidates: []string{"/tmp/demo/任务提示词.md"},
		Git: pgCodeGitContext{
			InGit:        true,
			ChangedFiles: []string{"app/main.go"},
		},
	})

	if !strings.Contains(prompt, "/pg-code") {
		t.Fatalf("prompt = %q, want /pg-code prefix", prompt)
	}
	if !strings.Contains(prompt, "只能基于任务提示词、git 变更、最近更新文件以及你实际读取过的文件下结论") {
		t.Fatalf("prompt missing evidence guardrail: %q", prompt)
	}
	if !strings.Contains(prompt, "\"prompt_candidates\"") {
		t.Fatalf("prompt missing serialized context: %q", prompt)
	}
}

func TestApplyCodexReviewEvidenceGuardsDowngradesWithoutPromptEvidence(t *testing.T) {
	repoDir := t.TempDir()
	filePath := filepath.Join(repoDir, "main.go")
	if err := os.WriteFile(filePath, []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go) error = %v", err)
	}

	result := CodexReviewResult{
		IsCompleted:  true,
		IsSatisfied:  true,
		ReviewNotes:  "无",
		NextPrompt:   "无",
		KeyLocations: "main.go:2",
	}

	applyCodexReviewEvidenceGuards(repoDir, &pgCodeProjectContext{
		Exists:           true,
		PromptCandidates: nil,
		Git: pgCodeGitContext{
			InGit:        true,
			ChangedFiles: []string{"main.go"},
		},
	}, &result)

	if result.IsCompleted {
		t.Fatalf("IsCompleted = true, want false")
	}
	if result.IsSatisfied {
		t.Fatalf("IsSatisfied = true, want false")
	}
	if !strings.Contains(result.ReviewNotes, "依据不足：未找到任务提示词") {
		t.Fatalf("ReviewNotes = %q, want missing prompt evidence", result.ReviewNotes)
	}
	if result.NextPrompt == "无" {
		t.Fatalf("NextPrompt = %q, want fallback prompt", result.NextPrompt)
	}
}

func TestApplyCodexReviewEvidenceGuardsDowngradesInvalidKeyLocations(t *testing.T) {
	repoDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(repoDir, "main.go"), []byte("package main\n"), 0o644); err != nil {
		t.Fatalf("os.WriteFile(main.go) error = %v", err)
	}

	result := CodexReviewResult{
		IsCompleted:  true,
		IsSatisfied:  true,
		ReviewNotes:  "无",
		NextPrompt:   "无",
		KeyLocations: "missing.go:8",
	}

	applyCodexReviewEvidenceGuards(repoDir, &pgCodeProjectContext{
		Exists:           true,
		PromptCandidates: []string{filepath.Join(repoDir, "任务提示词.md")},
		Git: pgCodeGitContext{
			InGit:        true,
			ChangedFiles: []string{"main.go"},
		},
	}, &result)

	if result.IsCompleted || result.IsSatisfied {
		t.Fatalf("result = %#v, want downgraded booleans", result)
	}
	if !strings.Contains(result.ReviewNotes, "关键代码位置无效") {
		t.Fatalf("ReviewNotes = %q, want invalid key location note", result.ReviewNotes)
	}
}
