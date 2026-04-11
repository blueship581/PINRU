package chat

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"

	appcli "github.com/blueship581/pinru/app/cli"
	appprompt "github.com/blueship581/pinru/app/prompt"
	"github.com/blueship581/pinru/internal/store"
)

// Service manages chat sessions and drives the Claude CLI for each message.
type ChatService struct {
	store  *store.Store
	cliSvc *appcli.CliService
}

// NewService creates a new chat service.
func New(store *store.Store, cliSvc *appcli.CliService) *ChatService {
	return &ChatService{store: store, cliSvc: cliSvc}
}

// ─── Request / Response types ────────────────────────────────────────────────

// CreateSessionRequest creates a new chat session for a task.
type CreateSessionRequest struct {
	TaskID string `json:"taskId"`
	Model  string `json:"model"`
}

// SendMessageRequest sends a message within an existing session.
type SendMessageRequest struct {
	SessionID      string `json:"sessionId"`
	Content        string `json:"content"`
	Model          string `json:"model"`
	ThinkingDepth  string `json:"thinkingDepth"`
	Mode           string `json:"mode"`
	WorkDir        string `json:"workDir"`
	PermissionMode string `json:"permissionMode"` // "" or "yolo"
	AutoSavePrompt bool   `json:"autoSavePrompt"`
}

// SendMessageResponse is returned immediately after the CLI session starts.
type SendMessageResponse struct {
	// UserMessageID is saved immediately before CLI execution starts.
	UserMessageID string `json:"userMessageId"`
	// CLISessionID is the polling handle for streaming output.
	CLISessionID string `json:"cliSessionId"`
	// AssistantMessageID is pre-allocated; content is filled once CLI finishes.
	AssistantMessageID string `json:"assistantMessageId"`
}

// SessionWithMessages bundles a session with its full message history.
type SessionWithMessages struct {
	Session  store.ChatSession   `json:"session"`
	Messages []store.ChatMessage `json:"messages"`
}

type promptArtifactSnapshot struct {
	exists  bool
	modTime time.Time
	size    int64
}

type generatedPromptPayload struct {
	Version         int    `json:"version"`
	Prompt          string `json:"prompt"`
	PromptText      string `json:"promptText"`
	ArtifactPath    string `json:"artifactPath"`
	ArtifactPathAlt string `json:"artifact_path"`
	FileWritten     *bool  `json:"fileWritten"`
	FileWrittenAlt  *bool  `json:"file_written"`
}

const (
	promptOutputStartMarker = "<<<PINRU_PROMPT_START>>>"
	promptOutputEndMarker   = "<<<PINRU_PROMPT_END>>>"
)

const promptGenerationManualDir = "/Users/gaobo/repositories/gitlab/评审项目/执行手册"

func (p generatedPromptPayload) promptValue() string {
	if strings.TrimSpace(p.Prompt) != "" {
		return strings.TrimSpace(p.Prompt)
	}
	return strings.TrimSpace(p.PromptText)
}

// ─── Session management ──────────────────────────────────────────────────────

func (s *ChatService) CreateSession(req CreateSessionRequest) (*store.ChatSession, error) {
	if strings.TrimSpace(req.TaskID) == "" {
		return nil, fmt.Errorf("taskId 不能为空")
	}
	model := req.Model
	if model == "" {
		model = "claude-sonnet-4-6"
	}
	return s.store.CreateChatSession(req.TaskID, "新对话", model)
}

func (s *ChatService) ListSessions(taskID, model string) ([]store.ChatSession, error) {
	if strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("taskId 不能为空")
	}
	sessions, err := s.store.ListChatSessions(taskID, model)
	if err != nil {
		return nil, err
	}
	if sessions == nil {
		sessions = []store.ChatSession{}
	}
	return sessions, nil
}

func (s *ChatService) GetSessionWithMessages(sessionID string) (*SessionWithMessages, error) {
	sess, err := s.store.GetChatSession(sessionID)
	if err != nil {
		return nil, fmt.Errorf("会话不存在: %s", sessionID)
	}
	msgs, err := s.store.ListChatMessages(sessionID)
	if err != nil {
		return nil, err
	}
	if msgs == nil {
		msgs = []store.ChatMessage{}
	}
	return &SessionWithMessages{Session: *sess, Messages: msgs}, nil
}

func (s *ChatService) RenameSession(sessionID, title string) error {
	title = strings.TrimSpace(title)
	if title == "" {
		return fmt.Errorf("标题不能为空")
	}
	return s.store.UpdateChatSessionTitle(sessionID, title)
}

func (s *ChatService) DeleteSession(sessionID string) error {
	return s.store.DeleteChatSession(sessionID)
}

// ─── Messaging ───────────────────────────────────────────────────────────────

// SendMessage persists the user turn, starts the CLI process, and launches a
// background goroutine to save the assistant reply once execution completes.
// Returns immediately with the CLI session ID so the frontend can start polling.
func (s *ChatService) SendMessage(req SendMessageRequest) (*SendMessageResponse, error) {
	content := strings.TrimSpace(req.Content)
	if content == "" {
		return nil, fmt.Errorf("消息内容不能为空")
	}
	if strings.TrimSpace(req.WorkDir) == "" {
		return nil, fmt.Errorf("workDir 不能为空，请先完成领题 Clone")
	}

	// Fetch session + history for context building
	swm, err := s.GetSessionWithMessages(req.SessionID)
	if err != nil {
		return nil, err
	}

	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = swm.Session.Model
	}
	if model != swm.Session.Model {
		if err := s.store.UpdateChatSessionModel(req.SessionID, model); err != nil {
			return nil, fmt.Errorf("更新会话模型失败: %w", err)
		}
		swm.Session.Model = model
	}

	if req.AutoSavePrompt {
		task, err := s.store.GetTask(swm.Session.TaskID)
		if err != nil {
			return nil, fmt.Errorf("读取任务失败: %w", err)
		}
		if task == nil {
			return nil, fmt.Errorf("任务不存在: %s", swm.Session.TaskID)
		}
		if task.PromptGenerationStatus == "running" {
			return nil, fmt.Errorf("当前任务正在后台生成提示词，请稍后再试")
		}
	}

	// Save user message
	userMsg, err := s.store.AddChatMessage(req.SessionID, "user", content)
	if err != nil {
		return nil, fmt.Errorf("保存用户消息失败: %w", err)
	}

	// Pre-allocate assistant message with empty content (will be filled async)
	assistantMsg, err := s.store.AddChatMessage(req.SessionID, "assistant", "")
	if err != nil {
		if cleanupErr := s.store.DeleteChatMessage(userMsg.ID); cleanupErr != nil {
			return nil, fmt.Errorf("预分配 assistant 消息失败: %w；用户消息清理失败: %v", err, cleanupErr)
		}
		return nil, fmt.Errorf("预分配 assistant 消息失败: %w", err)
	}

	// Build full conversation prompt including prior history
	fullPrompt := buildConversationPrompt(swm.Messages, content)

	var promptStartedAt int64
	var promptSnapshot promptArtifactSnapshot
	permissionMode := req.PermissionMode
	additionalDirs := []string(nil)
	if req.AutoSavePrompt {
		promptStartedAt = time.Now().Unix()
		promptSnapshot = capturePromptArtifactSnapshot(req.WorkDir)
		permissionMode = normalizeBackgroundPermissionMode(permissionMode)
		additionalDirs = promptGenerationAdditionalDirs()
		if err := s.store.StartTaskPromptGeneration(swm.Session.TaskID, promptStartedAt); err != nil {
			if cleanupErr := s.cleanupFailedSendMessage(userMsg.ID, assistantMsg.ID); cleanupErr != nil {
				return nil, fmt.Errorf("更新提示词后台状态失败: %w；消息清理失败: %v", err, cleanupErr)
			}
			return nil, fmt.Errorf("更新提示词后台状态失败: %w", err)
		}
	}

	// Start CLI
	cliResp, err := s.cliSvc.StartClaude(appcli.StartClaudeRequest{
		WorkDir:        req.WorkDir,
		Prompt:         fullPrompt,
		Model:          model,
		ThinkingDepth:  req.ThinkingDepth,
		Mode:           req.Mode,
		PermissionMode: permissionMode,
		AdditionalDirs: additionalDirs,
	})
	if err != nil {
		if req.AutoSavePrompt {
			if failErr := s.store.FailTaskPromptGeneration(swm.Session.TaskID, "启动失败: "+err.Error(), promptStartedAt); failErr != nil {
				return nil, fmt.Errorf("启动失败: %w；提示词状态回写失败: %v", err, failErr)
			}
		}
		if cleanupErr := s.cleanupFailedSendMessage(userMsg.ID, assistantMsg.ID); cleanupErr != nil {
			return nil, fmt.Errorf("启动失败: %w；消息清理失败: %v", err, cleanupErr)
		}
		return nil, err
	}

	assistantMsgID := assistantMsg.ID
	cliSessionID := cliResp.SessionID

	// Background goroutine: wait for CLI to finish, collect output, persist
	go func() {
		var lines []string
		offset := 0
		promptPersisted := false
		persistedPromptText := ""
		persistedWarning := ""
		for {
			poll, err := s.cliSvc.PollOutput(appcli.PollOutputRequest{
				SessionID: cliSessionID,
				Offset:    offset,
			})
			if err != nil {
				_ = s.store.UpdateChatMessage(assistantMsgID, "[轮询失败: "+err.Error()+"]")
				if req.AutoSavePrompt {
					_ = s.store.FailTaskPromptGeneration(swm.Session.TaskID, "轮询失败: "+err.Error(), promptStartedAt)
				}
				return
			}
			lines = append(lines, poll.Lines...)
			offset += len(poll.Lines)
			if req.AutoSavePrompt && !promptPersisted {
				promptText, warning, ready, err := s.tryPersistGeneratedPromptBeforeDone(
					swm.Session.TaskID,
					req.WorkDir,
					promptSnapshot,
					strings.Join(lines, "\n"),
					promptStartedAt,
				)
				if err != nil {
					_ = s.store.FailTaskPromptGeneration(swm.Session.TaskID, err.Error(), promptStartedAt)
					if trimmed := strings.TrimSpace(strings.Join(lines, "\n")); trimmed != "" {
						_ = s.store.UpdateChatMessage(assistantMsgID, trimmed+"\n\n[提示词回写失败: "+err.Error()+"]")
					} else {
						_ = s.store.UpdateChatMessage(assistantMsgID, "[提示词回写失败: "+err.Error()+"]")
					}
					return
				}
				if ready {
					promptPersisted = true
					persistedPromptText = promptText
					persistedWarning = warning
					_ = s.store.UpdateChatMessage(assistantMsgID, renderPersistedPromptResult(promptText, warning))
				}
			}
			if poll.Done {
				result := strings.Join(lines, "\n")
				if poll.ErrMsg != "" {
					result += "\n\n[执行错误: " + poll.ErrMsg + "]"
				}
				if req.AutoSavePrompt {
					if poll.ErrMsg != "" && !promptPersisted {
						_ = s.store.FailTaskPromptGeneration(swm.Session.TaskID, poll.ErrMsg, promptStartedAt)
					} else if !promptPersisted {
						promptText, warning, err := s.persistGeneratedPrompt(swm.Session.TaskID, req.WorkDir, promptSnapshot, result, promptStartedAt)
						if err != nil {
							_ = s.store.FailTaskPromptGeneration(swm.Session.TaskID, err.Error(), promptStartedAt)
							if strings.TrimSpace(result) != "" {
								result += "\n\n"
							}
							result += "[提示词回写失败: " + err.Error() + "]"
						} else {
							result = promptText
							if warning != "" {
								if strings.TrimSpace(result) != "" {
									result += "\n\n"
								}
								result += "[" + warning + "]"
							}
						}
					} else {
						result = persistedPromptText
						if persistedWarning != "" {
							if strings.TrimSpace(result) != "" {
								result += "\n\n"
							}
							result += "[" + persistedWarning + "]"
						}
						if poll.ErrMsg != "" {
							if strings.TrimSpace(result) != "" {
								result += "\n\n"
							}
							result += "[执行错误: " + poll.ErrMsg + "]"
						}
					}
				}
				_ = s.store.UpdateChatMessage(assistantMsgID, result)
				// Auto-title the session from first user message
				_ = s.autoTitleSession(swm.Session.ID, swm.Messages, content)
				return
			}
		}
	}()

	return &SendMessageResponse{
		UserMessageID:      userMsg.ID,
		CLISessionID:       cliSessionID,
		AssistantMessageID: assistantMsgID,
	}, nil
}

func (s *ChatService) cleanupFailedSendMessage(userMessageID, assistantMessageID string) error {
	if err := s.store.DeleteChatMessage(assistantMessageID); err != nil {
		return err
	}
	if err := s.store.DeleteChatMessage(userMessageID); err != nil {
		return err
	}
	return nil
}

func capturePromptArtifactSnapshot(workDir string) promptArtifactSnapshot {
	info, err := os.Stat(appprompt.PromptArtifactPath(workDir))
	if err != nil {
		return promptArtifactSnapshot{}
	}

	return promptArtifactSnapshot{
		exists:  true,
		modTime: info.ModTime(),
		size:    info.Size(),
	}
}

func promptArtifactUpdated(snapshot promptArtifactSnapshot, info os.FileInfo) bool {
	if !snapshot.exists {
		return true
	}
	if !info.ModTime().Equal(snapshot.modTime) {
		return true
	}
	return info.Size() != snapshot.size
}

func readUpdatedPromptArtifact(workDir string, snapshot promptArtifactSnapshot) (string, error) {
	path := appprompt.PromptArtifactPath(workDir)
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("生成完成，但未找到提示词文件: %s", path)
		}
		return "", fmt.Errorf("读取提示词文件信息失败: %w", err)
	}

	if !promptArtifactUpdated(snapshot, info) {
		return "", fmt.Errorf("生成完成，但未检测到新的提示词文件写入: %s", path)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("读取提示词文件失败: %w", err)
	}

	promptText := strings.TrimSpace(string(content))
	if promptText == "" {
		return "", fmt.Errorf("提示词文件内容为空: %s", path)
	}

	return promptText, nil
}

func (s *ChatService) persistGeneratedPrompt(taskID, workDir string, snapshot promptArtifactSnapshot, cliOutput string, startedAt int64) (string, string, error) {
	promptText, fromFile, err := resolveGeneratedPrompt(workDir, snapshot, cliOutput)
	if err != nil {
		return "", "", err
	}

	var warning string
	if !fromFile {
		if err := appprompt.WritePromptArtifact(workDir, promptText); err != nil {
			warning = "提示词已自动保存到任务，但补写文件失败: " + err.Error()
		}
	}

	if err := s.store.CompleteTaskPromptGeneration(taskID, promptText, startedAt); err != nil {
		return "", "", fmt.Errorf("保存提示词到任务失败: %w", err)
	}

	return promptText, warning, nil
}

func resolveGeneratedPrompt(workDir string, snapshot promptArtifactSnapshot, cliOutput string) (string, bool, error) {
	promptText, err := readUpdatedPromptArtifact(workDir, snapshot)
	if err == nil {
		return promptText, true, nil
	}

	extracted, extractErr := extractPromptFromCLIOutput(cliOutput)
	if extractErr != nil {
		return "", false, fmt.Errorf("%s；同时无法从模型输出提取提示词: %v", err, extractErr)
	}

	return extracted, false, nil
}

func normalizeBackgroundPermissionMode(mode string) string {
	trimmed := strings.TrimSpace(mode)
	if trimmed == "" || trimmed == "default" {
		return "acceptEdits"
	}
	return trimmed
}

func promptGenerationAdditionalDirs() []string {
	info, err := os.Stat(promptGenerationManualDir)
	if err != nil || !info.IsDir() {
		return nil
	}
	return []string{promptGenerationManualDir}
}

func renderPersistedPromptResult(promptText, warning string) string {
	result := strings.TrimSpace(promptText)
	if warning == "" {
		return result
	}
	if result == "" {
		return "[" + warning + "]"
	}
	return result + "\n\n[" + warning + "]"
}

func (s *ChatService) tryPersistGeneratedPromptBeforeDone(taskID, workDir string, snapshot promptArtifactSnapshot, cliOutput string, startedAt int64) (string, string, bool, error) {
	promptText, fromFile, ready, err := resolveGeneratedPromptBeforeDone(workDir, snapshot, cliOutput)
	if err != nil || !ready {
		return "", "", ready, err
	}

	var warning string
	if !fromFile {
		if err := appprompt.WritePromptArtifact(workDir, promptText); err != nil {
			warning = "提示词已自动保存到任务，但补写文件失败: " + err.Error()
		}
	}

	if err := s.store.CompleteTaskPromptGeneration(taskID, promptText, startedAt); err != nil {
		return "", "", false, fmt.Errorf("保存提示词到任务失败: %w", err)
	}

	return promptText, warning, true, nil
}

func extractPromptFromCLIOutput(output string) (string, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(output, "\r\n", "\n"))
	if normalized == "" {
		return "", fmt.Errorf("模型输出为空")
	}

	if payload, ok, err := extractPromptJSONPayload(normalized); ok {
		if err != nil {
			return "", err
		}
		return payload.promptValue(), nil
	}

	if candidate, ok := extractPromptBetweenMarkers(normalized); ok {
		if cleaned := cleanPromptCandidate(candidate); promptCandidateScore(cleaned) >= 4 {
			return cleaned, nil
		}
	}

	candidate := cleanPromptCandidate(normalized)
	if promptCandidateScore(candidate) >= 4 {
		return candidate, nil
	}

	best := ""
	bestScore := 0
	for _, block := range strings.Split(normalized, "\n\n") {
		cleaned := cleanPromptCandidate(block)
		score := promptCandidateScore(cleaned)
		if score > bestScore {
			best = cleaned
			bestScore = score
		}
	}
	if bestScore >= 4 {
		return best, nil
	}

	return "", fmt.Errorf("模型输出中没有识别到可用的提示词正文")
}

func resolveGeneratedPromptBeforeDone(workDir string, snapshot promptArtifactSnapshot, cliOutput string) (string, bool, bool, error) {
	promptText, err := readUpdatedPromptArtifact(workDir, snapshot)
	if err == nil {
		return promptText, true, true, nil
	}

	normalized := strings.TrimSpace(strings.ReplaceAll(cliOutput, "\r\n", "\n"))
	if normalized == "" {
		return "", false, false, nil
	}

	if payload, ok, err := extractPromptJSONPayload(normalized); ok {
		if err != nil {
			return "", false, false, nil
		}
		return payload.promptValue(), false, true, nil
	}

	if candidate, ok := extractPromptBetweenMarkers(normalized); ok {
		cleaned := cleanPromptCandidate(candidate)
		if promptCandidateScore(cleaned) >= 4 {
			return cleaned, false, true, nil
		}
	}

	return "", false, false, nil
}

func extractPromptJSONPayload(output string) (generatedPromptPayload, bool, error) {
	candidates := []string{strings.TrimSpace(output)}
	if trimmedFence := strings.TrimSpace(trimPromptCodeFence(output)); trimmedFence != "" && trimmedFence != candidates[0] {
		candidates = append(candidates, trimmedFence)
	}
	if jsonObject, ok := extractFirstJSONObject(output); ok {
		jsonObject = strings.TrimSpace(jsonObject)
		alreadyIncluded := false
		for _, candidate := range candidates {
			if candidate == jsonObject {
				alreadyIncluded = true
				break
			}
		}
		if !alreadyIncluded {
			candidates = append(candidates, jsonObject)
		}
	}

	var jsonErr error
	for _, candidate := range candidates {
		payload, ok, err := tryParsePromptJSONPayload(candidate)
		if ok {
			if err != nil {
				return generatedPromptPayload{}, true, err
			}
			return payload, true, nil
		}
		if err != nil && jsonErr == nil {
			jsonErr = err
		}
	}

	if jsonErr != nil {
		return generatedPromptPayload{}, false, nil
	}
	return generatedPromptPayload{}, false, nil
}

func tryParsePromptJSONPayload(candidate string) (generatedPromptPayload, bool, error) {
	trimmed := strings.TrimSpace(candidate)
	if trimmed == "" || !strings.HasPrefix(trimmed, "{") {
		return generatedPromptPayload{}, false, nil
	}

	var payload generatedPromptPayload
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return generatedPromptPayload{}, true, fmt.Errorf("JSON 解析失败: %w", err)
	}

	promptText := payload.promptValue()
	if promptText == "" {
		return generatedPromptPayload{}, true, fmt.Errorf("JSON 中 prompt 为空")
	}

	payload.Prompt = promptText
	return payload, true, nil
}

func extractFirstJSONObject(text string) (string, bool) {
	for start := 0; start < len(text); start++ {
		if text[start] != '{' {
			continue
		}
		if candidate, ok := extractBalancedJSONObject(text[start:]); ok {
			return candidate, true
		}
	}
	return "", false
}

func extractBalancedJSONObject(text string) (string, bool) {
	depth := 0
	inString := false
	escaped := false

	for index, r := range text {
		if escaped {
			escaped = false
			continue
		}
		if inString {
			switch r {
			case '\\':
				escaped = true
			case '"':
				inString = false
			}
			continue
		}

		switch r {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[:index+utf8.RuneLen(r)], true
			}
			if depth < 0 {
				return "", false
			}
		}
	}

	return "", false
}

func extractPromptBetweenMarkers(output string) (string, bool) {
	start := strings.Index(output, promptOutputStartMarker)
	if start < 0 {
		return "", false
	}
	afterStart := output[start+len(promptOutputStartMarker):]
	end := strings.Index(afterStart, promptOutputEndMarker)
	if end < 0 {
		return "", false
	}
	return strings.TrimSpace(afterStart[:end]), true
}

func cleanPromptCandidate(raw string) string {
	text := strings.TrimSpace(strings.ReplaceAll(raw, "\r\n", "\n"))
	if text == "" {
		return ""
	}

	text = trimPromptCodeFence(text)
	lines := strings.Split(text, "\n")
	cleaned := make([]string, 0, len(lines))
	lastWasBlank := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			if len(cleaned) == 0 || lastWasBlank {
				continue
			}
			cleaned = append(cleaned, "")
			lastWasBlank = true
			continue
		}

		lastWasBlank = false
		if line == promptOutputStartMarker || line == promptOutputEndMarker {
			continue
		}

		line = strings.TrimSpace(stripPromptLeadIn(line))
		if line == "" || isPromptStatusLine(line) || isPromptNoiseLine(line) {
			continue
		}

		cleaned = append(cleaned, line)
	}

	return strings.TrimSpace(strings.Join(cleaned, "\n"))
}

func trimPromptCodeFence(text string) string {
	if !strings.HasPrefix(text, "```") {
		return text
	}

	lines := strings.Split(text, "\n")
	if len(lines) < 2 {
		return text
	}
	if !strings.HasPrefix(strings.TrimSpace(lines[0]), "```") {
		return text
	}
	lastLine := strings.TrimSpace(lines[len(lines)-1])
	if lastLine != "```" {
		return text
	}

	return strings.TrimSpace(strings.Join(lines[1:len(lines)-1], "\n"))
}

func stripPromptLeadIn(line string) string {
	prefixes := []string{
		"最终提示词：",
		"最终提示词:",
		"提示词：",
		"提示词:",
		"润色后提示词：",
		"润色后提示词:",
		"以下是最终提示词：",
		"以下是最终提示词:",
		"以下是提示词：",
		"以下是提示词:",
		"以下是润色后的提示词：",
		"以下是润色后的提示词:",
		"回显提示词：",
		"回显提示词:",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(line, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
	}
	return line
}

func isPromptStatusLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	lower := strings.ToLower(trimmed)
	if strings.Contains(trimmed, "任务提示词.md") {
		return true
	}
	if strings.HasPrefix(trimmed, "/") && strings.HasSuffix(lower, ".md") {
		return true
	}
	if len(trimmed) > 2 && trimmed[1] == ':' && (trimmed[2] == '\\' || trimmed[2] == '/') && strings.HasSuffix(lower, ".md") {
		return true
	}

	prefixes := []string{
		"已写入",
		"已保存到",
		"写入路径",
		"保存路径",
		"输出路径",
		"文件路径",
		"绝对路径",
		"path:",
		"路径:",
		"pwd:",
		"写入到",
		"文件已保存",
		"生成文件",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(lower, strings.ToLower(prefix)) {
			return true
		}
	}

	return false
}

func isPromptNoiseLine(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}

	if utf8.RuneCountInString(trimmed) <= 24 && (strings.HasSuffix(trimmed, "：") || strings.HasSuffix(trimmed, ":")) {
		if strings.Contains(trimmed, "提示词") || strings.Contains(trimmed, "结果") {
			return true
		}
	}

	prefixes := []string{
		"已完成，结果如下",
		"已完成，提示词如下",
		"生成完成，结果如下",
		"以下是最终提示词",
		"以下是提示词",
		"以下是润色后的提示词",
		"最终提示词如下",
		"润色后的提示词如下",
		"这是最终提示词",
		"这是润色后的提示词",
		"任务提示词如下",
		"回显提示词如下",
		"请查收",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(trimmed, prefix) {
			return true
		}
	}

	return false
}

func promptCandidateScore(text string) int {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return 0
	}

	score := 0
	runeCount := utf8.RuneCountInString(trimmed)
	switch {
	case runeCount >= 30:
		score += 2
	case runeCount >= 12:
		score += 1
	}

	if containsHanRune(trimmed) {
		score += 2
	}
	if strings.ContainsAny(trimmed, "。！？") {
		score += 2
	}
	if strings.Contains(trimmed, "约束") {
		score += 1
	}

	nonEmptyLines := 0
	for _, line := range strings.Split(trimmed, "\n") {
		if strings.TrimSpace(line) != "" {
			nonEmptyLines++
		}
	}
	switch {
	case nonEmptyLines >= 2 && nonEmptyLines <= 6:
		score += 2
	case nonEmptyLines == 1:
		score += 1
	case nonEmptyLines > 8:
		score--
	}

	if strings.Contains(trimmed, "任务提示词.md") {
		score -= 6
	}
	if isPromptStatusLine(trimmed) {
		score -= 6
	}

	return score
}

func containsHanRune(text string) bool {
	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

// GetMessage returns a single message by ID (used to poll assistant content).
func (s *ChatService) GetMessage(messageID string) (*store.ChatMessage, error) {
	return s.store.GetChatMessage(messageID)
}

// SaveMessageAsPrompt copies the content of a chat message into the task's
// prompt_text field and marks the task as PromptReady.
func (s *ChatService) SaveMessageAsPrompt(taskID, messageID string) error {
	msg, err := s.store.GetChatMessage(messageID)
	if err != nil {
		return fmt.Errorf("消息不存在: %w", err)
	}
	if msg == nil || strings.TrimSpace(msg.Content) == "" {
		return fmt.Errorf("消息内容为空，无法保存为提示词")
	}

	promptText := strings.TrimSpace(msg.Content)
	if extracted, extractErr := extractPromptFromCLIOutput(promptText); extractErr == nil {
		promptText = extracted
	}

	task, err := appprompt.LoadTaskForPromptSync(s.store, taskID)
	if err != nil {
		return err
	}

	if err := s.store.UpdateTaskPrompt(taskID, promptText); err != nil {
		return err
	}

	appprompt.BestEffortSyncTaskPromptArtifact(task, promptText)
	return nil
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// buildConversationPrompt reconstructs the conversation history as plain text
// context and appends the new user turn. Claude will see the full thread.
func buildConversationPrompt(prior []store.ChatMessage, newUserContent string) string {
	if len(prior) == 0 {
		return newUserContent
	}

	var sb strings.Builder
	sb.WriteString("以下是本次对话的历史记录，请在此基础上继续回答：\n\n")
	for _, msg := range prior {
		if msg.Role == "user" {
			sb.WriteString("User: ")
		} else {
			sb.WriteString("Assistant: ")
		}
		sb.WriteString(msg.Content)
		sb.WriteString("\n\n")
	}
	sb.WriteString("User: ")
	sb.WriteString(newUserContent)
	return sb.String()
}

// autoTitleSession sets a meaningful title on the first message exchange.
func (s *ChatService) autoTitleSession(sessionID string, prior []store.ChatMessage, firstUserMsg string) error {
	// Only auto-title when this is the first user message (prior was empty)
	if len(prior) > 0 {
		return nil
	}
	title := firstUserMsg
	// Truncate to ~40 runes
	runes := []rune(title)
	if len(runes) > 40 {
		title = string(runes[:40]) + "…"
	}
	// Remove newlines
	title = strings.ReplaceAll(title, "\n", " ")
	title = strings.TrimSpace(title)
	if utf8.RuneCountInString(title) == 0 {
		return nil
	}
	return s.store.UpdateChatSessionTitle(sessionID, title)
}
