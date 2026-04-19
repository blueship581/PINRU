package gitops

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/errs"
	"github.com/blueship581/pinru/internal/util"
)

var excludedDirs = map[string]bool{
	"node_modules": true, "dist": true, "dist-ssr": true, ".git": true,
}
var excludedFiles = map[string]bool{
	".DS_Store": true,
}

const (
	localSnapshotAuthorName  = "PINRU Local"
	localSnapshotAuthorEmail = "pinru@local"
	localSnapshotCommitMsg   = "chore: 初始化模型副本基线"
	fallbackBranchName       = "main"
)

func CheckPathsExist(paths []string) []string {
	existing := make([]string, 0)
	for _, p := range paths {
		expanded := util.ExpandTilde(p)
		if _, err := os.Stat(expanded); err == nil {
			existing = append(existing, p)
		}
	}
	return existing
}

func CloneWithProgress(ctx context.Context, cloneURL, path, username, token string, skipTLSVerify bool, onProgress func(string)) error {
	if ctx == nil {
		ctx = context.Background()
	}
	expanded := util.ExpandTilde(path)
	if _, err := os.Stat(expanded); err == nil {
		return fmt.Errorf(errs.FmtTargetDirExists, filepath.Base(expanded))
	}
	if parent := filepath.Dir(expanded); parent != "" {
		os.MkdirAll(parent, 0755)
	}

	// Clone into a staging directory; rename to the final path only on success.
	// This ensures the target directory is never left in a partial state: on any
	// failure the staging directory is cleaned up by the deferred RemoveAll.
	stagingPath := expanded + "._pinru_tmp"
	os.RemoveAll(stagingPath) // remove any leftover from a previous failed attempt
	defer os.RemoveAll(stagingPath)

	onProgress("正在启动 git clone …")

	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", "--progress", cloneURL, stagingPath)
	cmd.WaitDelay = 5 * time.Second
	cmd.Env = append(os.Environ(), buildGitAuthEnv(cloneURL, username, token, skipTLSVerify)...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf(errs.FmtGitStartFail, err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf(errs.FmtGitStartFail, err)
	}

	// Read stderr in a goroutine. When context is cancelled, close the read end
	// of the pipe to unblock the scanner immediately instead of waiting for the
	// child process to exit and close the write end.
	scanDone := make(chan struct{})
	go func() {
		defer close(scanDone)
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			onProgress(scanner.Text())
		}
	}()

	go func() {
		select {
		case <-ctx.Done():
			stderr.Close()
		case <-scanDone:
		}
	}()

	<-scanDone

	if err := cmd.Wait(); err != nil {
		if ctxErr := contextErr(ctx); ctxErr != nil {
			return ctxErr
		}
		return fmt.Errorf(errs.FmtGitCloneFailCause, err)
	}

	// Atomically promote the staging directory to the final path.
	if err := os.Rename(stagingPath, expanded); err != nil {
		return fmt.Errorf(errs.FmtMoveCloneDirFail, err)
	}
	onProgress("克隆完成")
	return nil
}

func CopyProjectDirectory(ctx context.Context, src, dst string) error {
	if ctx == nil {
		ctx = context.Background()
	}
	expandedSrc := util.ExpandTilde(src)
	expandedDst := util.ExpandTilde(dst)
	if _, err := os.Stat(expandedSrc); os.IsNotExist(err) {
		return fmt.Errorf(errs.FmtSourceDirNotExist, expandedSrc)
	}
	if _, err := os.Stat(expandedDst); err == nil {
		return fmt.Errorf(errs.FmtTargetDirExists, filepath.Base(expandedDst))
	}
	if err := os.MkdirAll(filepath.Dir(expandedDst), 0755); err != nil {
		return err
	}

	// Copy into a staging directory; rename to the final path only on success.
	// This ensures the target directory is never left in a partial state on failure
	// (e.g. context cancellation during git add -A or a mid-copy I/O error).
	stagingDst := expandedDst + "._pinru_tmp"
	os.RemoveAll(stagingDst) // remove any leftover from a previous failed attempt
	defer os.RemoveAll(stagingDst)

	if err := os.MkdirAll(stagingDst, 0755); err != nil {
		return err
	}
	if err := copyDirRecursive(ctx, expandedSrc, stagingDst, false); err != nil {
		return err
	}
	if hasGitMetadata(expandedSrc) {
		if err := initializeSnapshotRepository(ctx, expandedSrc, stagingDst); err != nil {
			return err
		}
	}

	// Atomically promote the staging directory to the final path.
	if err := os.Rename(stagingDst, expandedDst); err != nil {
		return fmt.Errorf(errs.FmtCopyDirMoveFail, err)
	}
	return nil
}

func EnsureSnapshotRepository(ctx context.Context, referencePath, path string) (bool, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	expandedPath := util.ExpandTilde(strings.TrimSpace(path))
	if expandedPath == "" {
		return false, errors.New(errs.MsgTargetDirRequired)
	}

	info, err := os.Stat(expandedPath)
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, fmt.Errorf(errs.FmtTargetPathNotDir, expandedPath)
	}
	if hasGitMetadata(expandedPath) {
		return false, nil
	}

	expandedReferencePath := util.ExpandTilde(strings.TrimSpace(referencePath))
	if expandedReferencePath == "" {
		expandedReferencePath = expandedPath
	}
	if err := initializeSnapshotRepository(ctx, expandedReferencePath, expandedPath); err != nil {
		return false, err
	}
	return true, nil
}

func RecreateWorkspace(path, remoteURL, authorName, authorEmail string) error {
	if _, err := os.Stat(path); err == nil {
		if err := removeManagedWorkspace(path); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}

	if err := runGit(path, "init"); err != nil {
		return err
	}
	if err := runGit(path, "config", "user.name", authorName); err != nil {
		return err
	}
	if err := runGit(path, "config", "user.email", authorEmail); err != nil {
		return err
	}
	return runGit(path, "remote", "add", "origin", remoteURL)
}

func CopyProjectContents(src, dst string) error {
	if _, err := os.Stat(src); os.IsNotExist(err) {
		return fmt.Errorf(errs.FmtSourceDirNotExist, src)
	}
	return copyDirRecursive(context.Background(), src, dst, true)
}

func CommitAll(path, branch, authorName, authorEmail, msg string) (bool, error) {
	if err := runGit(path, "config", "user.name", authorName); err != nil {
		return false, err
	}
	if err := runGit(path, "config", "user.email", authorEmail); err != nil {
		return false, err
	}

	ensureBranch(path, branch)
	runGit(path, "add", "-A")

	// Check if there are staged changes
	cmd := exec.Command("git", "diff", "--cached", "--quiet")
	cmd.Dir = path
	if err := cmd.Run(); err == nil {
		return false, nil // no changes
	}

	if err := runGit(path, "commit", "-m", msg); err != nil {
		return false, err
	}
	return true, nil
}

func CreateOrResetBranch(path, branch, base string) error {
	runGit(path, "checkout", base)
	// Delete existing branch if present
	exec.Command("git", "-C", path, "branch", "-D", branch).Run()
	if err := runGit(path, "checkout", "-b", branch); err != nil {
		return err
	}
	return clearWorkspaceContents(path)
}

func EnsureBranch(path, branch string) error {
	return ensureBranch(path, branch)
}

func PushBranch(path, branch, username, token string) error {
	// Get origin URL
	cmd := exec.Command("git", "remote", "get-url", "origin")
	cmd.Dir = path
	out, err := cmd.Output()
	if err != nil {
		return fmt.Errorf(errs.FmtRemoteURLFail, err)
	}
	originURL := strings.TrimSpace(string(out))

	pushCmd := exec.Command("git", "push", "origin", branch+":"+branch, "--force")
	pushCmd.Dir = path
	pushCmd.Env = append(os.Environ(), buildGitAuthEnv(originURL, username, token, false)...)
	pushCmd.Stderr = os.Stderr
	return pushCmd.Run()
}

func WorkspaceRoot() string {
	return filepath.Join(os.TempDir(), "pinru-github-pr")
}

func WorkspacePath(targetRepo string) string {
	sanitized := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, targetRepo)
	return filepath.Join(WorkspaceRoot(), sanitized)
}

func buildGitAuthEnv(rawURL, username, token string, skipTLSVerify bool) []string {
	trimmedUsername := strings.TrimSpace(username)
	trimmedToken := strings.TrimSpace(token)
	parsedURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return []string{"GIT_TERMINAL_PROMPT=0"}
	}

	baseURL := fmt.Sprintf("%s://%s/", parsedURL.Scheme, parsedURL.Host)
	env := []string{"GIT_TERMINAL_PROMPT=0"}
	configIndex := 0
	if skipTLSVerify {
		env = append(env,
			"GIT_CONFIG_KEY_"+strconv.Itoa(configIndex)+"=http."+baseURL+".sslVerify",
			"GIT_CONFIG_VALUE_"+strconv.Itoa(configIndex)+"=false",
		)
		configIndex++
	}
	if trimmedUsername != "" && trimmedToken != "" {
		authHeader := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(trimmedUsername+":"+trimmedToken))
		env = append(env,
			"GIT_CONFIG_KEY_"+strconv.Itoa(configIndex)+"=http."+baseURL+".extraHeader",
			"GIT_CONFIG_VALUE_"+strconv.Itoa(configIndex)+"="+authHeader,
		)
		configIndex++
	}
	if configIndex == 0 {
		return env
	}
	return append(env, "GIT_CONFIG_COUNT="+strconv.Itoa(configIndex))
}

func contextErr(ctx context.Context) error {
	if ctx == nil || ctx.Err() == nil {
		return nil
	}
	cause := context.Cause(ctx)
	if cause != nil && !errors.Is(cause, context.Canceled) {
		return cause
	}
	return ctx.Err()
}

func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func runGitCtx(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	cmd.WaitDelay = 5 * time.Second
	return cmd.Run()
}

func runGitOutput(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func ensureBranch(path, branch string) error {
	cmd := exec.Command("git", "rev-parse", "--verify", branch)
	cmd.Dir = path
	if err := cmd.Run(); err != nil {
		// Branch doesn't exist, create it
		return runGit(path, "checkout", "-b", branch)
	}
	return runGit(path, "checkout", branch)
}

func clearWorkspaceContents(path string) error {
	if !util.IsWithinBasePath(WorkspaceRoot(), path) || util.SamePath(WorkspaceRoot(), path) {
		return fmt.Errorf(errs.FmtRefuseCleanOutside, path)
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		fullPath := filepath.Join(path, entry.Name())
		if err := os.RemoveAll(fullPath); err != nil {
			return err
		}
	}
	return nil
}

func removeManagedWorkspace(path string) error {
	expanded := filepath.Clean(util.ExpandTilde(path))
	root := filepath.Clean(WorkspaceRoot())
	if !util.IsWithinBasePath(root, expanded) || util.SamePath(root, expanded) {
		return fmt.Errorf(errs.FmtRefuseDeleteOutsideDir, path)
	}
	return os.RemoveAll(expanded)
}

func hasGitMetadata(path string) bool {
	info, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil && info.IsDir()
}

func initializeSnapshotRepository(ctx context.Context, sourcePath, destinationPath string) error {
	branch := fallbackBranchName
	if detectedBranch, err := runGitOutput(sourcePath, "branch", "--show-current"); err == nil && detectedBranch != "" {
		branch = detectedBranch
	}

	if err := initGitRepository(ctx, destinationPath, branch); err != nil {
		return err
	}
	if err := runGitCtx(ctx, destinationPath, "config", "user.name", localSnapshotAuthorName); err != nil {
		return err
	}
	if err := runGitCtx(ctx, destinationPath, "config", "user.email", localSnapshotAuthorEmail); err != nil {
		return err
	}
	if err := runGitCtx(ctx, destinationPath, "add", "-A"); err != nil {
		return err
	}
	return runGitCtx(ctx, destinationPath, "commit", "--allow-empty", "-m", localSnapshotCommitMsg)
}

func initGitRepository(ctx context.Context, path, branch string) error {
	if branch == "" {
		branch = fallbackBranchName
	}
	if err := runGitCtx(ctx, path, "init", "-b", branch); err == nil {
		return nil
	}
	if err := runGitCtx(ctx, path, "init"); err != nil {
		return err
	}
	currentBranch, err := runGitOutput(path, "branch", "--show-current")
	if err == nil && currentBranch == branch {
		return nil
	}
	return runGitCtx(ctx, path, "checkout", "-b", branch)
}

func copyDirRecursive(ctx context.Context, src, dst string, publishMode bool) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		rel, _ := filepath.Rel(src, path)
		if rel == "." {
			return nil
		}

		name := d.Name()

		if d.IsDir() {
			if name == ".git" {
				return filepath.SkipDir
			}
			if publishMode && excludedDirs[name] {
				return filepath.SkipDir
			}
			return os.MkdirAll(filepath.Join(dst, rel), 0755)
		}

		if excludedFiles[name] {
			return nil
		}
		if publishMode && strings.HasSuffix(name, ".log") {
			return nil
		}

		dstPath := filepath.Join(dst, rel)
		if err := os.MkdirAll(filepath.Dir(dstPath), 0755); err != nil {
			return err
		}
		return copyFileStreaming(path, dstPath)
	})
}

func copyFileStreaming(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcFile.Close()

	srcInfo, err := srcFile.Stat()
	if err != nil {
		return err
	}

	dstFile, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, srcInfo.Mode())
	if err != nil {
		return err
	}
	defer dstFile.Close()

	_, err = io.Copy(dstFile, srcFile)
	return err
}
