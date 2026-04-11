package gitops

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

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

func CloneWithProgress(cloneURL, path, username, token string, onProgress func(string)) error {
	expanded := util.ExpandTilde(path)
	if _, err := os.Stat(expanded); err == nil {
		return fmt.Errorf("目标目录「%s」已存在", filepath.Base(expanded))
	}
	if parent := filepath.Dir(expanded); parent != "" {
		os.MkdirAll(parent, 0755)
	}

	onProgress("正在启动 git clone …")

	cmd := exec.Command("git", "clone", "--depth", "1", "--progress", cloneURL, expanded)
	cmd.Env = append(os.Environ(), buildGitAuthEnv(cloneURL, username, token)...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("无法启动 git 命令: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法启动 git 命令: %w", err)
	}

	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		onProgress(scanner.Text())
	}

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("git clone 失败: %w", err)
	}
	onProgress("克隆完成")
	return nil
}

func CopyProjectDirectory(src, dst string) error {
	expandedSrc := util.ExpandTilde(src)
	expandedDst := util.ExpandTilde(dst)
	if _, err := os.Stat(expandedSrc); os.IsNotExist(err) {
		return fmt.Errorf("源目录不存在: %s", expandedSrc)
	}
	if _, err := os.Stat(expandedDst); err == nil {
		return fmt.Errorf("目标目录「%s」已存在", filepath.Base(expandedDst))
	}
	if err := os.MkdirAll(expandedDst, 0755); err != nil {
		return err
	}
	if err := copyDirRecursive(expandedSrc, expandedDst, false); err != nil {
		return err
	}
	if !hasGitMetadata(expandedSrc) {
		return nil
	}
	return initializeSnapshotRepository(expandedSrc, expandedDst)
}

func EnsureSnapshotRepository(referencePath, path string) (bool, error) {
	expandedPath := util.ExpandTilde(strings.TrimSpace(path))
	if expandedPath == "" {
		return false, fmt.Errorf("目标目录不能为空")
	}

	info, err := os.Stat(expandedPath)
	if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, fmt.Errorf("目标路径不是目录: %s", expandedPath)
	}
	if hasGitMetadata(expandedPath) {
		return false, nil
	}

	expandedReferencePath := util.ExpandTilde(strings.TrimSpace(referencePath))
	if expandedReferencePath == "" {
		expandedReferencePath = expandedPath
	}
	if err := initializeSnapshotRepository(expandedReferencePath, expandedPath); err != nil {
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
		return fmt.Errorf("源目录不存在: %s", src)
	}
	return copyDirRecursive(src, dst, true)
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
		return fmt.Errorf("获取 remote URL 失败: %w", err)
	}
	originURL := strings.TrimSpace(string(out))

	pushCmd := exec.Command("git", "push", "origin", branch+":"+branch, "--force")
	pushCmd.Dir = path
	pushCmd.Env = append(os.Environ(), buildGitAuthEnv(originURL, username, token)...)
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

func buildGitAuthEnv(rawURL, username, token string) []string {
	trimmedUsername := strings.TrimSpace(username)
	trimmedToken := strings.TrimSpace(token)
	if trimmedUsername == "" || trimmedToken == "" {
		return nil
	}

	parsedURL, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return []string{"GIT_TERMINAL_PROMPT=0"}
	}

	baseURL := fmt.Sprintf("%s://%s/", parsedURL.Scheme, parsedURL.Host)
	authHeader := "Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(trimmedUsername+":"+trimmedToken))

	return []string{
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_COUNT=1",
		"GIT_CONFIG_KEY_0=http." + baseURL + ".extraHeader",
		"GIT_CONFIG_VALUE_0=" + authHeader,
	}
}

func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
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
		return fmt.Errorf("拒绝清理受管范围外的工作目录: %s", path)
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
		return fmt.Errorf("拒绝删除受管范围外的工作目录: %s", path)
	}
	return os.RemoveAll(expanded)
}

func hasGitMetadata(path string) bool {
	info, err := os.Stat(filepath.Join(path, ".git"))
	return err == nil && info.IsDir()
}

func initializeSnapshotRepository(sourcePath, destinationPath string) error {
	branch := fallbackBranchName
	if detectedBranch, err := runGitOutput(sourcePath, "branch", "--show-current"); err == nil && detectedBranch != "" {
		branch = detectedBranch
	}

	if err := initGitRepository(destinationPath, branch); err != nil {
		return err
	}
	if err := runGit(destinationPath, "config", "user.name", localSnapshotAuthorName); err != nil {
		return err
	}
	if err := runGit(destinationPath, "config", "user.email", localSnapshotAuthorEmail); err != nil {
		return err
	}
	if err := runGit(destinationPath, "add", "-A"); err != nil {
		return err
	}
	return runGit(destinationPath, "commit", "--allow-empty", "-m", localSnapshotCommitMsg)
}

func initGitRepository(path, branch string) error {
	if branch == "" {
		branch = fallbackBranchName
	}
	if err := runGit(path, "init", "-b", branch); err == nil {
		return nil
	}
	if err := runGit(path, "init"); err != nil {
		return err
	}
	currentBranch, err := runGitOutput(path, "branch", "--show-current")
	if err == nil && currentBranch == branch {
		return nil
	}
	return runGit(path, "checkout", "-b", branch)
}

func copyDirRecursive(src, dst string, publishMode bool) error {
	return filepath.WalkDir(src, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
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
		os.MkdirAll(filepath.Dir(dstPath), 0755)
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(dstPath, data, 0644)
	})
}
