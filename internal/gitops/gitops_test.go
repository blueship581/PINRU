package gitops

import (
	"context"
	"encoding/base64"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildGitAuthEnvUsesExtraHeader(t *testing.T) {
	env := buildGitAuthEnv("https://github.com/example/repo.git", "alice", "secret-token")
	envMap := make(map[string]string, len(env))
	for _, item := range env {
		key, value, ok := strings.Cut(item, "=")
		if !ok {
			t.Fatalf("invalid env item: %q", item)
		}
		envMap[key] = value
	}

	if envMap["GIT_TERMINAL_PROMPT"] != "0" {
		t.Fatalf("GIT_TERMINAL_PROMPT = %q, want 0", envMap["GIT_TERMINAL_PROMPT"])
	}
	if envMap["GIT_CONFIG_KEY_0"] != "http.https://github.com/.extraHeader" {
		t.Fatalf("GIT_CONFIG_KEY_0 = %q", envMap["GIT_CONFIG_KEY_0"])
	}

	header := envMap["GIT_CONFIG_VALUE_0"]
	if !strings.HasPrefix(header, "Authorization: Basic ") {
		t.Fatalf("GIT_CONFIG_VALUE_0 = %q, want Basic auth header", header)
	}

	rawValue := strings.TrimPrefix(header, "Authorization: Basic ")
	decoded, err := base64.StdEncoding.DecodeString(rawValue)
	if err != nil {
		t.Fatalf("DecodeString() error = %v", err)
	}
	if string(decoded) != "alice:secret-token" {
		t.Fatalf("decoded header = %q, want alice:secret-token", decoded)
	}
}

func TestBuildGitAuthEnvDisablesPromptWithoutCredentials(t *testing.T) {
	env := buildGitAuthEnv("https://github.com/example/repo.git", "", "")
	if len(env) != 1 || env[0] != "GIT_TERMINAL_PROMPT=0" {
		t.Fatalf("env = %v, want only GIT_TERMINAL_PROMPT=0", env)
	}
}

func TestCloneWithProgressHonorsContextCancellation(t *testing.T) {
	root := t.TempDir()
	fakeBin := filepath.Join(root, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatalf("MkdirAll(fakeBin) error = %v", err)
	}

	gitPath := filepath.Join(fakeBin, "git")
	script := strings.Join([]string{
		"#!/bin/sh",
		"trap 'exit 143' TERM INT",
		"printf 'fake clone starting\\n' >&2",
		"sleep 10",
	}, "\n")
	if err := os.WriteFile(gitPath, []byte(script), 0o755); err != nil {
		t.Fatalf("WriteFile(gitPath) error = %v", err)
	}

	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))

	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := CloneWithProgress(ctx, "https://example.com/demo.git", filepath.Join(root, "clone"), "", "", func(string) {})
	elapsed := time.Since(start)

	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("CloneWithProgress() error = %v, want context deadline exceeded", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("CloneWithProgress() elapsed = %v, want prompt cancellation", elapsed)
	}
}

func TestRemoveManagedWorkspaceRejectsOutsideWorkspaceRoot(t *testing.T) {
	if err := removeManagedWorkspace(t.TempDir()); err == nil {
		t.Fatalf("expected removeManagedWorkspace() to reject unmanaged path")
	}
}

func TestRemoveManagedWorkspaceDeletesManagedWorkspace(t *testing.T) {
	path := WorkspacePath("owner/repo")
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(path, "README.md"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := removeManagedWorkspace(path); err != nil {
		t.Fatalf("removeManagedWorkspace() error = %v", err)
	}

	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("workspace path should be removed, stat err = %v", err)
	}
}

func TestCopyProjectDirectoryInitializesGitRepoForGitSource(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "source")
	dst := filepath.Join(root, "copy")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(src, "README.md"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	initTestGitRepo(t, src, "review-base")
	gitInDir(t, src, "add", "README.md")
	gitInDir(t, src, "commit", "-m", "initial source snapshot")

	if err := CopyProjectDirectory(src, dst); err != nil {
		t.Fatalf("CopyProjectDirectory() error = %v", err)
	}

	if _, err := os.Stat(filepath.Join(dst, ".git")); err != nil {
		t.Fatalf("expected destination to have git metadata, stat err = %v", err)
	}

	status := gitOutput(t, dst, "status", "--short")
	if strings.TrimSpace(status) != "" {
		t.Fatalf("git status --short = %q, want clean working tree", status)
	}

	branch := gitOutput(t, dst, "branch", "--show-current")
	if branch != "review-base" {
		t.Fatalf("branch = %q, want review-base", branch)
	}

	message := gitOutput(t, dst, "log", "-1", "--pretty=%s")
	if message != localSnapshotCommitMsg {
		t.Fatalf("last commit message = %q, want %q", message, localSnapshotCommitMsg)
	}
}

func TestCopyProjectDirectoryLeavesPlainSourceWithoutGitRepo(t *testing.T) {
	root := t.TempDir()
	src := filepath.Join(root, "plain-source")
	dst := filepath.Join(root, "plain-copy")
	if err := os.MkdirAll(src, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(src, "README.md"), []byte("demo"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := CopyProjectDirectory(src, dst); err != nil {
		t.Fatalf("CopyProjectDirectory() error = %v", err)
	}

	if _, err := os.Stat(filepath.Join(dst, ".git")); !os.IsNotExist(err) {
		t.Fatalf("expected destination to remain plain copy, stat err = %v", err)
	}
}

func initTestGitRepo(t *testing.T, path, branch string) {
	t.Helper()
	if err := runGit(path, "init", "-b", branch); err != nil {
		if err := runGit(path, "init"); err != nil {
			t.Fatalf("git init error = %v", err)
		}
		gitInDir(t, path, "checkout", "-b", branch)
	}
	gitInDir(t, path, "config", "user.name", "Test User")
	gitInDir(t, path, "config", "user.email", "test@example.com")
}

func gitInDir(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
}

func gitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}
