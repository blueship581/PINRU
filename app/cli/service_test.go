package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// TestHelperProcess is not a real test. It is invoked as a subprocess by other
// tests to provide a cross-platform mock for external CLI binaries.
// Run via createMockCodexExecutable; do not call directly.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("GO_TEST_SUBPROCESS") != "1" {
		return
	}
	// Find the "--" separator; everything after it are the forwarded CLI args.
	args := os.Args
	for len(args) > 0 {
		if args[0] == "--" {
			args = args[1:]
			break
		}
		args = args[1:]
	}
	switch os.Getenv("GO_TEST_SUBPROCESS_MODE") {
	case "codex_error":
		fmt.Fprintln(os.Stderr, "ERROR: invalid schema")
		fmt.Fprintln(os.Stderr, "ERROR: additionalProperties must be false")
		os.Exit(1)
	default:
		fmt.Fprintf(os.Stderr, "unknown GO_TEST_SUBPROCESS_MODE: %s\n", os.Getenv("GO_TEST_SUBPROCESS_MODE"))
		os.Exit(1)
	}
}

// createMockCodexExecutable returns a path to a platform-appropriate executable
// that behaves according to mode when invoked as "codex". On Unix it creates a
// shell script; on Windows a .bat wrapper — both delegate to the test binary
// via the TestHelperProcess helper-process pattern.
func createMockCodexExecutable(t *testing.T, mode string) string {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatalf("os.Executable() error = %v", err)
	}
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		path := filepath.Join(dir, "codex.bat")
		content := fmt.Sprintf(
			"@echo off\r\nset GO_TEST_SUBPROCESS=1\r\nset GO_TEST_SUBPROCESS_MODE=%s\r\n\"%s\" -test.run=TestHelperProcess -- %%*\r\nexit /b %%errorlevel%%\r\n",
			mode, exe,
		)
		if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
			t.Fatalf("os.WriteFile(%s) error = %v", path, err)
		}
		return path
	}
	path := filepath.Join(dir, "codex")
	content := fmt.Sprintf(
		"#!/bin/sh\nGO_TEST_SUBPROCESS=1 GO_TEST_SUBPROCESS_MODE=%s exec %q -test.run=TestHelperProcess -- \"$@\"\n",
		mode, exe,
	)
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatalf("os.WriteFile(%s) error = %v", path, err)
	}
	return path
}

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
	mockPath := createMockCodexExecutable(t, "codex_error")

	svc := NewWithResolver(func(name string) (string, error) {
		if name != "codex" {
			t.Fatalf("unexpected CLI lookup: %s", name)
		}
		return mockPath, nil
	})

	_, err := svc.RunCodexReview(context.Background(), CodexReviewRequest{
		LocalPath:      repoDir,
		OriginalPrompt: "stub prompt",
	}, nil)
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
	prompt := buildCodexReviewPrompt(CodexReviewRequest{
		LocalPath:         "/tmp/demo",
		OriginalPrompt:    "实现每日任务与奖励记录",
		CurrentPrompt:     "修复奖励记录漏记问题",
		ParentReviewNotes: "奖励记录路径缺少空值保护",
		IssueType:         "Bug修复",
		IssueTitle:        "奖励记录异常处理",
		ModelName:         "cotv21-pro",
	}, &pgCodeProjectContext{
		ResolvedPath: "/tmp/demo",
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
	if !strings.Contains(prompt, "original_prompt/current_prompt 为唯一来源") {
		t.Fatalf("prompt missing db-only prompt guidance: %q", prompt)
	}
	if strings.Contains(prompt, "prompt_sources") || strings.Contains(prompt, "prompt_candidates") {
		t.Fatalf("prompt should not reference local prompt sources: %q", prompt)
	}
	if !strings.Contains(prompt, "实现每日任务与奖励记录") {
		t.Fatalf("prompt missing original prompt content: %q", prompt)
	}
	if !strings.Contains(prompt, "\"parent_review_notes\": \"奖励记录路径缺少空值保护\"") {
		t.Fatalf("prompt missing parent review notes: %q", prompt)
	}
	if !strings.Contains(prompt, "\"issue_title\": \"奖励记录异常处理\"") {
		t.Fatalf("prompt missing issue title: %q", prompt)
	}
}

func TestRunCodexReviewRejectsWhenPromptsMissing(t *testing.T) {
	svc := New()
	_, err := svc.RunCodexReview(context.Background(), CodexReviewRequest{
		LocalPath:      t.TempDir(),
		OriginalPrompt: "   ",
		CurrentPrompt:  "",
	}, nil)
	if err == nil {
		t.Fatalf("RunCodexReview() error = nil, want rejection when prompts missing")
	}
	if !strings.Contains(err.Error(), "数据库中未保存该轮复审的提示词") {
		t.Fatalf("RunCodexReview() error = %q, want missing-prompt rejection", err.Error())
	}
}

func TestCompactPromptForWindowsCommandLine(t *testing.T) {
	raw := "/pg-code\n\n  第一行  \r\n\r\n{\n  \"prompt_candidates\": [\n    \"a.md\"\n  ]\n}\n"
	got := compactPromptForWindowsCommandLine(raw)

	if strings.Contains(got, "\n") || strings.Contains(got, "\r") {
		t.Fatalf("compactPromptForWindowsCommandLine() = %q, want single line", got)
	}
	if !strings.Contains(got, "/pg-code 第一行 {") {
		t.Fatalf("compactPromptForWindowsCommandLine() = %q, want joined content", got)
	}
	if !strings.Contains(got, "\"prompt_candidates\": [") {
		t.Fatalf("compactPromptForWindowsCommandLine() = %q, want JSON content retained", got)
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
		Exists: true,
		Git: pgCodeGitContext{
			InGit:        true,
			ChangedFiles: []string{"main.go"},
		},
	}, &result)

	// Invalid key locations is now a soft guard: result booleans are preserved.
	if !result.IsCompleted || !result.IsSatisfied {
		t.Fatalf("result = %#v, want booleans preserved (soft guard)", result)
	}
	if !strings.Contains(result.ReviewNotes, "关键代码位置格式无效") {
		t.Fatalf("ReviewNotes = %q, want invalid key location note", result.ReviewNotes)
	}
}
