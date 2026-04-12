package cli

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/blueship581/pinru/internal/util"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed manuals/*
var manualFS embed.FS

//go:embed schemas/pg_code_review.json
var pgCodeReviewSchema []byte

// Service executes the local claude CLI and streams output back via polling.
type CliService struct {
	mu         sync.Mutex
	sessions   map[string]*cliSession
	resolveCLI func(name string) (string, error) // nil → util.ResolveCLI
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

// NewService creates a new CLI service with background session cleanup.
func New() *CliService {
	svc := &CliService{
		sessions: make(map[string]*cliSession),
	}
	go svc.cleanupLoop()
	return svc
}

// NewWithResolver creates a CliService with a custom binary resolver. Use this
// in tests to simulate a missing CLI without touching the system PATH.
func NewWithResolver(fn func(name string) (string, error)) *CliService {
	svc := &CliService{
		sessions:   make(map[string]*cliSession),
		resolveCLI: fn,
	}
	go svc.cleanupLoop()
	return svc
}

// lookupCLI resolves the named binary using the configured resolver, or falls
// back to util.ResolveCLI when none is set.
func (s *CliService) lookupCLI(name string) (string, error) {
	if s.resolveCLI != nil {
		return s.resolveCLI(name)
	}
	return util.ResolveCLI(name)
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

// StartClaudeRequest describes a claude CLI invocation.
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
	// PermissionMode currently only supports the default guarded mode.
	PermissionMode string `json:"permissionMode"`
	// AdditionalDirs grants Claude access to paths outside WorkDir when needed.
	AdditionalDirs []string `json:"additionalDirs"`
	// EnvOverrides sets additional environment variables for the claude process.
	// These are applied on top of the current process environment.
	// Use this instead of --model to bypass CLI argument normalization (e.g. 4-6 → 4.6).
	EnvOverrides map[string]string `json:"envOverrides,omitempty"`
}

// StartClaudeResponse holds the session ID for output polling.
type StartClaudeResponse struct {
	SessionID string `json:"sessionId"`
}

// PollOutputRequest specifies which session and line offset to read from.
type PollOutputRequest struct {
	SessionID string `json:"sessionId"`
	Offset    int    `json:"offset"`
}

// PollOutputResponse contains new lines and completion state.
type PollOutputResponse struct {
	Lines  []string `json:"lines"`
	Done   bool     `json:"done"`
	ErrMsg string   `json:"errMsg"`
}

// SkillItem represents a single skill entry.
type SkillItem struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ─── Public methods ──────────────────────────────────────────────────────────

// CheckCLI returns the resolved path to the claude binary, or an error.
func (s *CliService) CheckCLI() (string, error) {
	path, err := s.lookupCLI("claude")
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

	claudePath, err := s.lookupCLI("claude")
	if err != nil {
		return nil, fmt.Errorf("claude CLI 未找到，请先安装: npm install -g @anthropic-ai/claude-code")
	}

	args, err := buildClaudeArgs(req)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)

	cmd := exec.CommandContext(ctx, claudePath, args...)
	cmd.Dir = req.WorkDir
	if len(req.EnvOverrides) > 0 {
		cmd.Env = applyEnvOverrides(os.Environ(), req.EnvOverrides)
	}

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

// InstallBuiltinSkills writes all skills bundled with PINRU to ~/.claude/skills/.
// Always overwrites to keep the installed version in sync with the binary.
// Manual dir placeholders ({{MANUAL_DIR}}) in skill content are replaced with
// the platform-appropriate path before writing.
func (s *CliService) InstallBuiltinSkills() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	manualDir := util.PinruManualDir()
	for dirName, content := range builtinSkills {
		skillDir := filepath.Join(home, ".claude", "skills", dirName)
		skillFile := filepath.Join(skillDir, "SKILL.md")
		if err := os.MkdirAll(skillDir, 0o755); err != nil {
			continue
		}
		resolved := strings.ReplaceAll(content, "{{MANUAL_DIR}}", manualDir)
		_ = os.WriteFile(skillFile, []byte(resolved), 0o644)
	}
}

// InstallBuiltinManuals extracts the bundled execution manuals to the
// platform data directory (~/.pinru/manuals/). Always overwrites to keep
// the installed version in sync with the binary.
func (s *CliService) InstallBuiltinManuals() {
	destDir := util.PinruManualDir()
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return
	}
	entries, err := manualFS.ReadDir("manuals")
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := manualFS.ReadFile("manuals/" + entry.Name())
		if err != nil {
			continue
		}
		_ = os.WriteFile(filepath.Join(destDir, entry.Name()), data, 0o644)
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func validatePermissionMode(mode string) error {
	trimmed := strings.TrimSpace(mode)
	if trimmed == "" || trimmed == "default" {
		return nil
	}
	switch trimmed {
	case "acceptEdits", "auto", "dontAsk", "plan":
		return nil
	case "yolo", "bypassPermissions":
		return nil
	}
	return fmt.Errorf("不支持的权限模式: %s", trimmed)
}

func buildClaudeArgs(req StartClaudeRequest) ([]string, error) {
	// Build the final prompt with thinking depth prefix and mode annotation
	finalPrompt := buildPrompt(req.Prompt, req.ThinkingDepth, req.Mode)
	if err := validatePermissionMode(req.PermissionMode); err != nil {
		return nil, err
	}

	args := []string{"-p", finalPrompt}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}

	permissionMode := normalizePermissionMode(req.PermissionMode)
	if permissionMode != "" {
		args = append(args, "--permission-mode", permissionMode)
	}

	if shouldSkipPermissions(req.PermissionMode) {
		args = append(args, "--dangerously-skip-permissions")
	}

	additionalDirs := uniqueNonEmptyStrings(req.AdditionalDirs)
	if len(additionalDirs) > 0 {
		args = append(args, "--add-dir")
		args = append(args, additionalDirs...)
	}

	if req.Mode == "plan" {
		// Plan mode: restrict to read-only tools so claude only plans, doesn't execute.
		args = append(args, "--allowedTools", "Read,Glob,Grep,WebFetch,WebSearch")
	}

	return args, nil
}

func normalizePermissionMode(mode string) string {
	trimmed := strings.TrimSpace(mode)
	switch trimmed {
	case "", "default":
		return ""
	case "yolo":
		return "bypassPermissions"
	default:
		return trimmed
	}
}

func shouldSkipPermissions(mode string) bool {
	trimmed := strings.TrimSpace(mode)
	return trimmed == "" || trimmed == "default" || trimmed == "yolo" || trimmed == "bypassPermissions"
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))

	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}

	return result
}

// applyEnvOverrides merges overrides into base environment slice.
// Each entry in the returned slice has the form "KEY=VALUE".
// Override keys replace any existing entries for the same key.
func applyEnvOverrides(base []string, overrides map[string]string) []string {
	// Build a set of keys to override so we can skip duplicates from base.
	skip := make(map[string]struct{}, len(overrides))
	for k := range overrides {
		skip[strings.ToUpper(k)] = struct{}{}
	}
	result := make([]string, 0, len(base)+len(overrides))
	for _, entry := range base {
		key := entry
		if idx := strings.IndexByte(entry, '='); idx >= 0 {
			key = entry[:idx]
		}
		if _, shouldOverride := skip[strings.ToUpper(key)]; !shouldOverride {
			result = append(result, entry)
		}
	}
	for k, v := range overrides {
		result = append(result, k+"="+v)
	}
	return result
}

// ─── Codex Review ────────────────────────────────────────────────────────────

// CodexReviewResult is the structured output from the pg-code review skill.
type CodexReviewResult struct {
	IsCompleted bool    `json:"isCompleted"`
	IsSatisfied bool    `json:"isSatisfied"`
	ProjectType string  `json:"projectType"`
	ChangeScope string  `json:"changeScope"`
	ReviewNotes string  `json:"reviewNotes"`
	NextPrompt  string  `json:"nextPrompt"`
	KeyLocations string `json:"keyLocations"`
}

// RunCodexReview executes the codex pg-code skill non-interactively on the given
// localPath, streaming each output line to onLine (may be nil), and returns the
// structured review result parsed from the --output-schema JSON file.
func (s *CliService) RunCodexReview(ctx context.Context, localPath string, onLine func(string)) (*CodexReviewResult, error) {
	codexPath, err := s.lookupCLI("codex")
	if err != nil {
		return nil, fmt.Errorf("codex CLI 未找到，请先安装: npm install -g @openai/codex")
	}

	// Write bundled schema to a temp file.
	schemaFile, err := os.CreateTemp("", "pinru-review-schema-*.json")
	if err != nil {
		return nil, fmt.Errorf("创建 schema 临时文件失败: %w", err)
	}
	schemaPath := schemaFile.Name()
	defer os.Remove(schemaPath)
	if _, err := schemaFile.Write(pgCodeReviewSchema); err != nil {
		schemaFile.Close()
		return nil, fmt.Errorf("写入 schema 失败: %w", err)
	}
	schemaFile.Close()

	// Temp file for the last-message output.
	outFile, err := os.CreateTemp("", "pinru-review-out-*.json")
	if err != nil {
		return nil, fmt.Errorf("创建输出临时文件失败: %w", err)
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	args := []string{
		"exec", "/pg-code",
		"-C", localPath,
		"--dangerously-bypass-approvals-and-sandbox",
		"--output-schema", schemaPath,
		"-o", outPath,
		"--ephemeral",
	}

	cmd := exec.CommandContext(ctx, codexPath, args...)
	cmd.Dir = localPath

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("创建 stdout 管道失败: %w", err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("创建 stderr 管道失败: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("启动 codex 失败: %w", err)
	}

	// Stream stdout and stderr, forwarding each line to the caller.
	var wg sync.WaitGroup
	wg.Add(2)
	streamPipe := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			if onLine != nil {
				onLine(scanner.Text())
			}
		}
	}
	go streamPipe(stdoutPipe)
	go streamPipe(stderrPipe)
	wg.Wait()

	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("codex 执行失败: %w", err)
	}

	// Parse the structured output file.
	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf("读取 codex 输出失败: %w", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, fmt.Errorf("codex 未生成结构化输出")
	}

	var result CodexReviewResult
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, fmt.Errorf("解析 codex 输出 JSON 失败: %w (raw: %s)", err, string(data))
	}
	return &result, nil
}

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
