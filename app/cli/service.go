package cli

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/blueship581/pinru/internal/errs"
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
	mu                    sync.Mutex
	sessions              map[string]*cliSession
	resolveCLI            func(name string) (string, error) // nil → util.ResolveCLI
	reviewContextPath     string
	reviewContextOverride func(ctx context.Context, localPath string) (*pgCodeProjectContext, error)
}

func defaultPgCodeContextScriptPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".codex", "skills", "pg-code", "scripts", "collect_project_context.py")
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

// SetReviewContextScriptPath overrides the pg-code context collection script path.
// Intended for tests; empty string restores the default lookup.
func (s *CliService) SetReviewContextScriptPath(path string) {
	s.reviewContextPath = path
}

// SetReviewContextOverride installs a stub used in place of the real python
// context-collection script. Pass nil to restore default behaviour. Test-only.
func (s *CliService) SetReviewContextOverride(fn func(ctx context.Context, localPath string) (*PgCodeProjectContext, error)) {
	if fn == nil {
		s.reviewContextOverride = nil
		return
	}
	s.reviewContextOverride = fn
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
		return "", fmt.Errorf(errs.MsgClaudeCliMissing)
	}
	return path, nil
}

// StartClaude launches a claude CLI session and returns a session ID for polling.
func (s *CliService) StartClaude(req StartClaudeRequest) (*StartClaudeResponse, error) {
	if strings.TrimSpace(req.WorkDir) == "" {
		return nil, fmt.Errorf(errs.MsgWorkDirRequired)
	}
	if strings.TrimSpace(req.Prompt) == "" {
		return nil, fmt.Errorf(errs.MsgPromptRequired)
	}

	claudePath, err := s.lookupCLI("claude")
	if err != nil {
		return nil, fmt.Errorf(errs.MsgClaudeCliMissing)
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
		return nil, fmt.Errorf(errs.FmtStdoutPipeFail, err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf(errs.FmtStderrPipeFail, err)
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf(errs.FmtClaudeStartClassicFail, err)
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
		return nil, fmt.Errorf(errs.FmtSessionNotFound, req.SessionID)
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
		return nil, fmt.Errorf(errs.FmtUserDirFail, err)
	}
	skillsDir := filepath.Join(home, ".claude", "skills")

	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []SkillItem{}, nil
		}
		return nil, fmt.Errorf(errs.FmtReadSkillDirFail, err)
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
	return fmt.Errorf(errs.FmtUnsupportedPermission, trimmed)
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

type CodexReviewIssue struct {
	Title        string `json:"title"`
	IssueType    string `json:"issueType"`
	ReviewNotes  string `json:"reviewNotes"`
	NextPrompt   string `json:"nextPrompt"`
	KeyLocations string `json:"keyLocations"`
}

// CodexReviewResult is the structured output from the pg-code review skill.
type CodexReviewResult struct {
	IsCompleted  bool               `json:"isCompleted"`
	IsSatisfied  bool               `json:"isSatisfied"`
	ProjectType  string             `json:"projectType"`
	ChangeScope  string             `json:"changeScope"`
	ReviewNotes  string             `json:"reviewNotes"`
	NextPrompt   string             `json:"nextPrompt"`
	KeyLocations string             `json:"keyLocations"`
	Issues       []CodexReviewIssue `json:"issues"`
}

type CodexReviewRequest struct {
	LocalPath         string `json:"localPath"`
	OriginalPrompt    string `json:"originalPrompt"`
	CurrentPrompt     string `json:"currentPrompt"`
	ParentReviewNotes string `json:"parentReviewNotes"`
	IssueType         string `json:"issueType"`
	IssueTitle        string `json:"issueTitle"`
	ModelName         string `json:"modelName"`

	// PreCollectedContext 为 job 层在任务发起阶段预采集好的项目上下文；
	// 非 nil 时 RunCodexReview 跳过二次采集，直接使用。
	PreCollectedContext *PgCodeProjectContext `json:"-"`
	// RoundHistory 为多轮复审的历史提示词规划，按 round_number 升序。
	RoundHistory []AiReviewHistoryEntry `json:"roundHistory,omitempty"`
}

// AiReviewHistoryEntry 描述多轮复审中某一历史轮次的关键提示词/结论，
// 用于第二轮及以后构造完整的复审上下文。
type AiReviewHistoryEntry struct {
	RoundNumber int    `json:"roundNumber"`
	PromptText  string `json:"promptText"`
	ReviewNotes string `json:"reviewNotes"`
	NextPrompt  string `json:"nextPrompt"`
}

// PgCodeProjectContext 是 pgCodeProjectContext 的导出别名，
// 供 job 层持有预采集结果并把引用传入 RunCodexReview。
type PgCodeProjectContext = pgCodeProjectContext

type pgCodeContextEnvelope struct {
	BaseDir  string                 `json:"base_dir"`
	Projects []pgCodeProjectContext `json:"projects"`
}

type pgCodeProjectContext struct {
	InputPath      string               `json:"input_path"`
	ResolvedPath   string               `json:"resolved_path"`
	Exists         bool                 `json:"exists"`
	ProjectIDGuess string               `json:"project_id_guess"`
	Git            pgCodeGitContext     `json:"git"`
	RecentFiles    []pgCodeRecentFile   `json:"recent_files"`
	Summary        pgCodeProjectSummary `json:"summary"`
}

type pgCodeGitContext struct {
	InGit           bool     `json:"in_git"`
	RepoRoot        *string  `json:"repo_root"`
	StatusLines     []string `json:"status_lines"`
	ChangedFiles    []string `json:"changed_files"`
	ChangedFilesRaw []string `json:"changed_files_repo_relative"`
}

type pgCodeRecentFile struct {
	Path         string `json:"path"`
	RelativePath string `json:"relative_path"`
	MTime        string `json:"mtime"`
}

type pgCodeProjectSummary struct {
	TopLevelEntries []string       `json:"top_level_entries"`
	Extensions      map[string]int `json:"extensions"`
}

// RunCodexReview executes the codex pg-code skill non-interactively on the given
// localPath, streaming each output line to onLine (may be nil), and returns the
// structured review result parsed from the --output-schema JSON file.
func (s *CliService) RunCodexReview(ctx context.Context, req CodexReviewRequest, onLine func(string)) (*CodexReviewResult, error) {
	codexPath, err := s.lookupCLI("codex")
	if err != nil {
		return nil, fmt.Errorf(errs.MsgCodexCliMissing)
	}
	localPath := strings.TrimSpace(req.LocalPath)
	if localPath == "" {
		return nil, fmt.Errorf(errs.MsgLocalPathRequired)
	}
	if strings.TrimSpace(req.OriginalPrompt) == "" && strings.TrimSpace(req.CurrentPrompt) == "" {
		return nil, fmt.Errorf(errs.MsgReviewPromptMissing)
	}

	reviewContext := req.PreCollectedContext
	if reviewContext == nil {
		collected, ctxErr := s.collectPgCodeReviewContext(ctx, localPath)
		if ctxErr != nil {
			return nil, fmt.Errorf("%s：%w", errs.MsgReviewContextCollectFailed, ctxErr)
		}
		reviewContext = collected
	}
	reviewPrompt := buildCodexReviewPrompt(req, reviewContext)
	if runtime.GOOS == "windows" {
		reviewPrompt = compactPromptForWindowsCommandLine(reviewPrompt)
	}

	// Write bundled schema to a temp file.
	schemaFile, err := os.CreateTemp("", "pinru-review-schema-*.json")
	if err != nil {
		return nil, fmt.Errorf(errs.FmtSchemaTempFileFail, err)
	}
	schemaPath := schemaFile.Name()
	defer os.Remove(schemaPath)
	if _, err := schemaFile.Write(pgCodeReviewSchema); err != nil {
		schemaFile.Close()
		return nil, fmt.Errorf(errs.FmtWriteSchemaFail, err)
	}
	schemaFile.Close()

	// Temp file for the last-message output.
	outFile, err := os.CreateTemp("", "pinru-review-out-*.json")
	if err != nil {
		return nil, fmt.Errorf(errs.FmtOutputTempFileFail, err)
	}
	outPath := outFile.Name()
	outFile.Close()
	defer os.Remove(outPath)

	args := []string{
		"exec", reviewPrompt,
		"-C", localPath,
		"--dangerously-bypass-approvals-and-sandbox",
		"--output-schema", schemaPath,
		"-o", outPath,
		"--ephemeral",
	}

	cmd := exec.CommandContext(ctx, codexPath, args...)
	cmd.Dir = localPath
	cmd.Env = applyEnvOverrides(os.Environ(), map[string]string{
		"PINRU_CODEX_REVIEW_OUTPUT_PATH": outPath,
	})

	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf(errs.FmtStdoutPipeWrap, err)
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf(errs.FmtStderrPipeWrap, err)
	}

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf(errs.FmtCodexStartFail, err)
	}

	// Stream stdout and stderr, forwarding each line to the caller.
	var wg sync.WaitGroup
	wg.Add(2)
	var recentOutputMu sync.Mutex
	recentOutput := make([]string, 0, 8)
	streamPipe := func(r io.Reader) {
		defer wg.Done()
		scanner := bufio.NewScanner(r)
		for scanner.Scan() {
			line := scanner.Text()
			appendRecentCodexOutput(&recentOutputMu, &recentOutput, line)
			if onLine != nil {
				onLine(line)
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
		if summary := formatRecentCodexOutput(recentOutput); summary != "" {
			return nil, fmt.Errorf(errs.FmtCodexRunFailWithSummary, err, summary)
		}
		return nil, fmt.Errorf(errs.FmtCodexRunFail, err)
	}

	// Parse the structured output file.
	data, err := os.ReadFile(outPath)
	if err != nil {
		return nil, fmt.Errorf(errs.FmtCodexReadOutputFail, err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, fmt.Errorf(errs.MsgCodexNoStructuredOutput)
	}

	var result CodexReviewResult
	if err := json.Unmarshal(data, &result); err != nil {
		slog.Error("codex 输出 JSON 解析失败", "err", err, "raw", string(data))
		return nil, fmt.Errorf(errs.FmtCodexParseJSONFail, err)
	}
	applyCodexReviewEvidenceGuards(localPath, reviewContext, &result)
	return &result, nil
}

func appendRecentCodexOutput(mu *sync.Mutex, lines *[]string, line string) {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return
	}

	mu.Lock()
	defer mu.Unlock()

	if len(*lines) == 8 {
		copy((*lines)[0:], (*lines)[1:])
		*lines = (*lines)[:7]
	}
	*lines = append(*lines, trimmed)
}

func formatRecentCodexOutput(lines []string) string {
	if len(lines) == 0 {
		return ""
	}
	return strings.Join(lines, " | ")
}

func (s *CliService) reviewContextScriptPath() string {
	if strings.TrimSpace(s.reviewContextPath) != "" {
		return s.reviewContextPath
	}
	return defaultPgCodeContextScriptPath()
}

// CollectReviewContext 在任务发起阶段由 job 层调用，负责采集一次项目上下文
// 并作为 hard error 反馈脚本缺失 / 执行失败。返回值传入 RunCodexReview 的
// CodexReviewRequest.PreCollectedContext 后可避免二次采集。
func (s *CliService) CollectReviewContext(ctx context.Context, localPath string) (*PgCodeProjectContext, error) {
	return s.collectPgCodeReviewContext(ctx, localPath)
}

func (s *CliService) collectPgCodeReviewContext(ctx context.Context, localPath string) (*pgCodeProjectContext, error) {
	if s.reviewContextOverride != nil {
		return s.reviewContextOverride(ctx, localPath)
	}
	scriptPath := strings.TrimSpace(s.reviewContextScriptPath())
	if scriptPath == "" {
		return nil, errors.New(errs.MsgReviewContextScriptMissing)
	}
	if _, err := os.Stat(scriptPath); err != nil {
		return nil, fmt.Errorf("%s：%w", errs.MsgReviewContextScriptMissing, err)
	}

	cmd := exec.CommandContext(ctx, "python3", scriptPath, localPath)
	cmd.Dir = localPath
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	var envelope pgCodeContextEnvelope
	if err := json.Unmarshal(output, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Projects) == 0 {
		return nil, nil
	}
	return &envelope.Projects[0], nil
}

func buildCodexReviewPrompt(req CodexReviewRequest, project *pgCodeProjectContext) string {
	var parts []string
	parts = append(parts, "/pg-code")
	parts = append(parts, strings.TrimSpace(`
补充规则：
1. 【严格限制】只能基于任务提示词、git 变更、最近更新文件以及你实际读取过的文件下结论。允许主动读取和评审的仓库文件仍限于 git 变更文件（git status / git diff 列出的文件）以及最近更新文件。
2. 严禁猜测运行效果、页面视觉、接口返回、测试结果或用户体验。
3. keyLocations 只能填写 git 变更文件或最近更新文件中 1 到 3 个你实际核验过的代码位置，写不出时可留空。
4. 当主要功能实现度达到 80% 以上时，isCompleted 和 isSatisfied 均可填 true，允许存在少量非关键细节缺失或边缘情况未覆盖。
5. 找不到任务提示词或有效改动时，reviewNotes 注明”依据不足”，isCompleted 和 isSatisfied 均填 false。
6. projectType 和 changeScope 按最符合实际情况的选项填写。
7. 任务提示词以“当前复核节点上下文”里的 original_prompt/current_prompt 为唯一来源，不要再去读取本地提示词文件；若两者都缺失请在 reviewNotes 注明并终止评审。
8. 当本轮发现多个独立问题时，必须通过 issues 数组分别列出；不要把多个问题揉成一条。
9. issues[*].issueType 默认填“Bug修复”，除非证据明确表明是其他类型。
10. 若本轮已通过，issues 返回空数组。
11. 【文风要求 - reviewNotes / nextPrompt / issues[*].description】像人一样说话：短句为主，先说问题再说位置。禁止使用以下 AI 腔套话：“此外”“综上”“值得注意的是”“深入探讨”“至关重要”“凸显”“格局”“不仅……还”“作为……的体现”“……的证明”“不仅仅是”；不要三段式铺陈、不要 -ing 结尾的肤浅总结、不要否定式排比、不要金句式收尾。
12. 【业务视角】从用户看到的业务行为和功能点描述问题，例如“领奖弹窗打开后奖励列表空白”，而不是堆砌类名/回调链等代码术语。代码位置放到 keyLocations，不要写进 reviewNotes；nextPrompt 直接说要做什么功能改动，不要重复复审结论。
`))

	reviewInput := map[string]any{
		"issue_title":         strings.TrimSpace(req.IssueTitle),
		"issue_type":          strings.TrimSpace(req.IssueType),
		"model_name":          strings.TrimSpace(req.ModelName),
		"original_prompt":     strings.TrimSpace(req.OriginalPrompt),
		"current_prompt":      strings.TrimSpace(req.CurrentPrompt),
		"parent_review_notes": strings.TrimSpace(req.ParentReviewNotes),
	}
	if len(req.RoundHistory) > 0 {
		reviewInput["round_history"] = req.RoundHistory
	}
	if contextJSON, err := json.MarshalIndent(reviewInput, "", "  "); err == nil {
		parts = append(parts, "当前复核节点上下文如下，请明确区分“原始任务提示词”“当前节点提示词”“父节点不满意结论”“历史轮次提示词规划（round_history，按轮次升序）”：\n"+string(contextJSON))
	}

	if project != nil {
		contextJSON, err := json.MarshalIndent(project, "", "  ")
		if err == nil {
			parts = append(parts, "下面是预采集到的项目上下文，请优先据此取证，不要忽略证据缺口：\n"+string(contextJSON))
		}
	}

	return strings.Join(parts, "\n\n")
}

func compactPromptForWindowsCommandLine(prompt string) string {
	replacer := strings.NewReplacer("\r\n", "\n", "\r", "\n")
	lines := strings.Split(replacer.Replace(prompt), "\n")
	compacted := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			compacted = append(compacted, trimmed)
		}
	}
	return strings.Join(compacted, " ")
}

func applyCodexReviewEvidenceGuards(localPath string, project *pgCodeProjectContext, result *CodexReviewResult) {
	if result == nil {
		return
	}

	// Hard guards: project must exist and have some verifiable changes.
	var hardReasons []string
	if project == nil {
		hardReasons = append(hardReasons, "未采集到复审上下文")
	} else {
		if !project.Exists {
			hardReasons = append(hardReasons, "项目目录不存在")
		}
		if len(project.Git.ChangedFiles) == 0 && len(project.RecentFiles) == 0 {
			hardReasons = append(hardReasons, "缺少可核验的改动或最近文件")
		}
	}

	if len(hardReasons) > 0 {
		result.IsCompleted = false
		result.IsSatisfied = false
		guardNote := "依据不足：" + strings.Join(hardReasons, "；")
		if note := strings.TrimSpace(result.ReviewNotes); note == "" || note == "无" {
			result.ReviewNotes = guardNote
		} else if !strings.Contains(note, "依据不足") {
			result.ReviewNotes = note + "；" + guardNote
		}
		if prompt := strings.TrimSpace(result.NextPrompt); prompt == "" || prompt == "无" {
			result.NextPrompt = "先补齐可核验的提示词和关键代码位置，再重新复审。"
		}
		return
	}

	// Soft guard: invalid key locations are noted but do not override the
	// AI's pass/fail judgment.
	if countValidKeyLocations(localPath, result.KeyLocations) == 0 && strings.TrimSpace(result.KeyLocations) != "" {
		note := "注：关键代码位置格式无效"
		if existing := strings.TrimSpace(result.ReviewNotes); existing == "" || existing == "无" {
			result.ReviewNotes = note
		} else {
			result.ReviewNotes = existing + "；" + note
		}
	}
}

func countValidKeyLocations(localPath, raw string) int {
	entries := splitKeyLocations(raw)
	valid := 0
	for _, entry := range entries {
		if isValidKeyLocation(localPath, entry) {
			valid++
		}
	}
	return valid
}

func splitKeyLocations(raw string) []string {
	replacer := strings.NewReplacer("；", ";", "，", ";", ",", ";")
	normalized := replacer.Replace(raw)
	parts := strings.Split(normalized, ";")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func isValidKeyLocation(localPath, entry string) bool {
	idx := strings.LastIndex(entry, ":")
	if idx <= 0 || idx >= len(entry)-1 {
		return false
	}

	relativePath := strings.TrimSpace(entry[:idx])
	lineText := strings.TrimSpace(entry[idx+1:])
	lineNumber, err := strconv.Atoi(lineText)
	if err != nil || lineNumber <= 0 {
		return false
	}

	filePath := filepath.Join(localPath, relativePath)
	data, err := os.ReadFile(filePath)
	if err != nil {
		return false
	}

	lineCount := bytes.Count(data, []byte{'\n'})
	if len(data) > 0 && data[len(data)-1] != '\n' {
		lineCount++
	}
	return lineCount >= lineNumber
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
