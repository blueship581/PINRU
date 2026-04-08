package gitops

import (
	"bufio"
	"fmt"
	"io/fs"
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

	authURL := buildAuthURL(cloneURL, username, token)
	onProgress("正在启动 git clone …")

	cmd := exec.Command("git", "clone", "--depth", "1", "--progress", authURL, expanded)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("无法启动 git 命令: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法启动 git 命令: %w", err)
	}

	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		safe := strings.ReplaceAll(scanner.Text(), authURL, cloneURL)
		onProgress(safe)
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
	os.MkdirAll(expandedDst, 0755)
	return copyDirRecursive(expandedSrc, expandedDst, false)
}

func RecreateWorkspace(path, remoteURL, authorName, authorEmail string) error {
	if _, err := os.Stat(path); err == nil {
		os.RemoveAll(path)
	}
	os.MkdirAll(path, 0755)

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
	authURL := buildAuthURL(originURL, username, token)

	pushCmd := exec.Command("git", "push", authURL, branch+":"+branch, "--force")
	pushCmd.Dir = path
	pushCmd.Stderr = os.Stderr
	return pushCmd.Run()
}

func WorkspacePath(targetRepo string) string {
	sanitized := strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, targetRepo)
	return filepath.Join(os.TempDir(), "pinru-github-pr-"+sanitized)
}

func buildAuthURL(rawURL, username, token string) string {
	if rest, ok := strings.CutPrefix(rawURL, "https://"); ok {
		return fmt.Sprintf("https://%s:%s@%s", username, token, rest)
	}
	if rest, ok := strings.CutPrefix(rawURL, "http://"); ok {
		return fmt.Sprintf("http://%s:%s@%s", username, token, rest)
	}
	return rawURL
}

func runGit(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Stderr = os.Stderr
	return cmd.Run()
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
	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.Name() == ".git" {
			continue
		}
		fullPath := filepath.Join(path, entry.Name())
		os.RemoveAll(fullPath)
	}
	return nil
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
