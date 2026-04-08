package main

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// CliService executes the local claude CLI and streams output back via polling.
type CliService struct {
	mu       sync.Mutex
	sessions map[string]*cliSession
}

type cliSession struct {
	mu       sync.Mutex
	lines    []string
	done     bool
	exitErr  string
	cancel   context.CancelFunc
	lastUsed time.Time
}

func (s *cliSession) append(line string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lines = append(s.lines, line)
	s.lastUsed = time.Now()
}

func (s *cliSession) finish(errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.done = true
	s.exitErr = errMsg
	s.lastUsed = time.Now()
}

func (s *cliSession) poll(offset int) (lines []string, done bool, errMsg string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if offset < len(s.lines) {
		lines = s.lines[offset:]
	}
	return lines, s.done, s.exitErr
}

func NewCliService() *CliService {
	svc := &CliService{
		sessions: make(map[string]*cliSession),
	}
	go svc.cleanupLoop()
	return svc
}

func (s *CliService) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		cutoff := time.Now().Add(-10 * time.Minute)
		for id, sess := range s.sessions {
			sess.mu.Lock()
			if sess.done && sess.lastUsed.Before(cutoff) {
				delete(s.sessions, id)
			}
			sess.mu.Unlock()
		}
		s.mu.Unlock()
	}
}

// ─── Request / Response types ───────────────────────────────────────────────

type StartClaudeRequest struct {
	// WorkDir is the repository directory to run claude in.
	WorkDir string `json:"workDir"`
	// Prompt is the user's prompt / task description.
	Prompt string `json:"prompt"`
	// Model e.g. "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"
	Model string `json:"model"`
	// ThinkingDepth: "", "think", "think harder", "ultrathink"
	ThinkingDepth string `json:"thinkingDepth"`
	// Mode: "agent" or "plan"
	Mode string `json:"mode"`
	// PermissionMode: "" or "yolo" (yolo adds --dangerously-skip-permissions)
	PermissionMode string `json:"permissionMode"`
}

type StartClaudeResponse struct {
	SessionID string `json:"sessionId"`
}

type PollOutputRequest struct {
	SessionID string `json:"sessionId"`
	Offset    int    `json:"offset"`
}

type PollOutputResponse struct {
	Lines   []string `json:"lines"`
	Done    bool     `json:"done"`
	ErrMsg  string   `json:"errMsg"`
}

// ─── Public methods ──────────────────────────────────────────────────────────

// CheckCLI returns the resolved path to the claude binary, or an error.
func (s *CliService) CheckCLI() (string, error) {
	path, err := exec.LookPath("claude")
	if err != nil {
		return "", fmt.Errorf("claude CLI 未找到，请先安装 Claude Code: npm install -g @anthropic-ai/claude-code")
	}
	return path, nil
}

// StartClaude launches a claude CLI session and returns a session ID for polling.
func (s *CliService) StartClaude(req StartClaudeRequest) (*StartClaudeResponse, error) {
	if strings.TrimSpace(req.WorkDir) == "" {
		return nil, fmt.Errorf("工作目录不能为空")
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, fmt.Errorf("提示词不能为空")
	}

	claudePath, err := exec.LookPath("claude")
	if err != nil {
		return nil, fmt.Errorf("claude CLI 未找到，请先安装: npm install -g @anthropic-ai/claude-code")
	}

	// Build the final prompt with thinking depth prefix and mode annotation
	finalPrompt := buildPrompt(req.Prompt, req.ThinkingDepth, req.Mode)

	// Assemble CLI arguments
	args := []string{"-p", finalPrompt}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	if req.Mode == "plan" {
		// Plan mode: restrict to read-only tools so claude only plans, doesn't execute
		args = append(args, "--allowedTools", "Read,Glob,Grep,WebFetch,WebSearch")
	}
	if req.PermissionMode == "yolo" {
		args = append(args, "--dangerously-skip-permissions")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)

	cmd := exec.CommandContext(ctx, claudePath, args...)
	cmd.Dir = req.WorkDir

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("无法创建输出管道: %v", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("无法创建错误管道: %v", err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("启动 claude 失败: %v", err)
	}

	sessionID := uuid.New().String()
	sess := &cliSession{
		cancel:   cancel,
		lastUsed: time.Now(),
	}

	s.mu.Lock()
	s.sessions[sessionID] = sess
	s.mu.Unlock()

	// Get the Wails application instance for event emission.
	app := application.Get()

	// Stream stdout and stderr concurrently
	var wg sync.WaitGroup
	wg.Add(2)

	streamReader := func(r io.Reader, prefix string) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := scanner.Text()
			if prefix != "" {
				line = prefix + line
			}
			sess.append(line)
			// Emit each line as a real-time event so the frontend can display
			// output without polling.
			app.Event.Emit("cli:line:"+sessionID, line)
		}
	}

	go streamReader(stdoutPipe, "")
	go streamReader(stderrPipe, "")

	go func() {
		wg.Wait()
		waitErr := cmd.Wait()
		cancel()
		var errMsg string
		if waitErr != nil {
			if ctx.Err() == context.DeadlineExceeded {
				errMsg = "执行超时（10 分钟）"
			} else {
				errMsg = waitErr.Error()
			}
		}
		// Emit done event before marking session finished so listeners receive
		// the terminal signal.
		app.Event.Emit("cli:done:"+sessionID, errMsg)
		sess.finish(errMsg)
	}()

	return &StartClaudeResponse{SessionID: sessionID}, nil
}

// PollOutput returns new output lines since the given offset.
func (s *CliService) PollOutput(req PollOutputRequest) (*PollOutputResponse, error) {
	s.mu.Lock()
	sess, ok := s.sessions[req.SessionID]
	s.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("会话不存在: %s", req.SessionID)
	}

	lines, done, errMsg := sess.poll(req.Offset)
	if lines == nil {
		lines = []string{}
	}
	return &PollOutputResponse{
		Lines:  lines,
		Done:   done,
		ErrMsg: errMsg,
	}, nil
}

// CancelSession terminates a running claude session.
func (s *CliService) CancelSession(sessionID string) error {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	s.mu.Unlock()
	if !ok {
		return nil // already gone or never existed — treat as success
	}
	sess.cancel()
	return nil
}

// ─── Skills ───────────────────────────────────────────────────────────────────

// SkillItem represents a single skill entry.
type SkillItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ListSkills scans ~/.claude/skills/, reads SKILL.md frontmatter from each
// subdirectory, and returns a sorted list of SkillItem.
func (s *CliService) ListSkills() ([]SkillItem, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("无法获取用户目录: %v", err)
	}
	skillsDir := filepath.Join(home, ".claude", "skills")

	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SkillItem{}, nil
		}
		return nil, fmt.Errorf("读取技能目录失败: %v", err)
	}

	var skills []SkillItem
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillMD := filepath.Join(skillsDir, entry.Name(), "SKILL.md")
		data, err := os.ReadFile(skillMD)
		if err != nil {
			continue
		}
		name, desc := parseSkillFrontmatter(string(data), entry.Name())
		skills = append(skills, SkillItem{Name: name, Description: desc})
	}

	sort.Slice(skills, func(i, j int) bool {
		return skills[i].Name < skills[j].Name
	})
	return skills, nil
}

// parseSkillFrontmatter extracts name and description from YAML frontmatter.
// Falls back to dirName for name and empty string for description.
func parseSkillFrontmatter(content, dirName string) (name, description string) {
	name = dirName
	lines := strings.Split(content, "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) != "---" {
		return
	}
	for i := 1; i < len(lines); i++ {
		line := lines[i]
		if strings.TrimSpace(line) == "---" {
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		switch key {
		case "name":
			if val != "" {
				name = val
			}
		case "description":
			if val != "" {
				description = val
			}
		}
	}
	return
}

// ─── Builtin Skill Installation ──────────────────────────────────────────────

// InstallBuiltinSkills writes all skills bundled with PINRU to ~/.claude/skills/.
// Always overwrites to keep the installed version in sync with the binary.
func (s *CliService) InstallBuiltinSkills() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	for dirName, content := range builtinSkills {
		skillDir := filepath.Join(home, ".claude", "skills", dirName)
		skillFile := filepath.Join(skillDir, "SKILL.md")
		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			continue
		}
		_ = os.WriteFile(skillFile, []byte(content), 0o644)
		_ = skillFile // written
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func buildPrompt(userPrompt, thinkingDepth, mode string) string {
	var sb strings.Builder

	// Thinking depth prefix
	switch strings.ToLower(thinkingDepth) {
	case "think":
		sb.WriteString("think\n\n")
	case "think harder":
		sb.WriteString("think harder\n\n")
	case "ultrathink":
		sb.WriteString("ultrathink\n\n")
	}

	// Mode annotation
	if mode == "plan" {
		sb.WriteString("【规划模式】仅输出实施计划，不执行任何文件修改或命令，不使用 Write/Edit/Bash 工具。\n\n")
	}

	sb.WriteString(userPrompt)
	return sb.String()
}
