package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/blueship581/pinru/internal/store"
	"github.com/blueship581/pinru/internal/util"
	_ "modernc.org/sqlite"
)

const (
	traeWorkspaceStorageRelativePath = "Library/Application Support/Trae CN/User/workspaceStorage"
	traeLogsRelativePath             = "Library/Application Support/Trae CN/logs"
)

var (
	traeTraceIDPattern                = regexp.MustCompile(`trace_id(?:=|: )"?([a-f0-9]{32})"?`)
	traeTimestampPattern              = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)`)
	traeWorkspaceUserIDPattern        = regexp.MustCompile(`^(\d+)_`)
	traeSessionLikePattern            = regexp.MustCompile(`(?:chat_session_id: |session_id=|chain_id=)([a-f0-9]{24})`)
	traeCreateMessageIDPattern        = regexp.MustCompile(`message_id: ([a-f0-9]{24})`)
	traeAssistantTaskMessageIDPattern = regexp.MustCompile(`task_id=[a-f0-9]{24}[^\n]*message_id=([a-f0-9]{24})`)
	traeUserMessageIDFallbackPattern  = regexp.MustCompile(`user_message_id: ([a-f0-9]{24})`)
	traeNoiseMessagePatterns          = []*regexp.Regexp{
		regexp.MustCompile(`^帮我启动`),
		regexp.MustCompile(`^启动(这个|当前)`),
		regexp.MustCompile(`^帮我运行`),
		regexp.MustCompile(`^运行(这个|当前)`),
	}
)

type ExtractedTraeSession struct {
	SessionID        string `json:"sessionId"`
	UserConversation string `json:"userConversation"`
	UserMessageCount int    `json:"userMessageCount"`
	FirstUserMessage string `json:"firstUserMessage"`
	LastActivityAt   *int64 `json:"lastActivityAt"`
	IsCurrent        bool   `json:"isCurrent"`
}

type ExtractTaskSessionCandidate struct {
	ID               string                 `json:"id"`
	WorkspacePath    string                 `json:"workspacePath"`
	MatchedPath      string                 `json:"matchedPath"`
	MatchKind        string                 `json:"matchKind"`
	SessionCount     int                    `json:"sessionCount"`
	UserID           string                 `json:"userId"`
	CurrentSessionID string                 `json:"currentSessionId"`
	UserMessageCount int                    `json:"userMessageCount"`
	Summary          string                 `json:"summary"`
	LastActivityAt   *int64                 `json:"lastActivityAt"`
	Sessions         []ExtractedTraeSession `json:"sessions"`
}

type ExtractTaskSessionsResult struct {
	TaskID     string                        `json:"taskId"`
	Candidates []ExtractTaskSessionCandidate `json:"candidates"`
}

type traeWorkspaceConversation struct {
	RawSessionID string
	IsCurrent    bool
}

type traeWorkspaceState struct {
	UserID              string
	CurrentRawSessionID string
	RawSessions         []traeWorkspaceConversation
	InputHistory        []string
}

type traeMatchedWorkspace struct {
	WorkspaceHash string
	WorkspacePath string
	MatchedPath   string
	MatchKind     string
	MatchScore    int
	StateDBPath   string
	State         traeWorkspaceState
}

type traeTraceRecord struct {
	TraceID            string
	RawSessionID       string
	AssistantMessageID string
	UserMessageID      string
	Timestamp          time.Time
	HasChatStart       bool
}

type traeMappedTurn struct {
	Record           traeTraceRecord
	UserConversation string
}

type traeCandidateBuild struct {
	Candidate  ExtractTaskSessionCandidate
	MatchScore int
	IsCurrent  bool
}

type traeWorkspaceJSON struct {
	Folder string `json:"folder"`
}

type traeWorkspaceMemento struct {
	List []struct {
		IsCurrent bool   `json:"isCurrent"`
		SessionID string `json:"sessionId"`
	} `json:"list"`
	CurrentSessionID string `json:"currentSessionId"`
}

type traeInputHistoryItem struct {
	InputText string `json:"inputText"`
}

func (s *TaskService) ExtractTaskSessions(taskID string) (*ExtractTaskSessionsResult, error) {
	task, err := s.store.GetTask(taskID)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, fmt.Errorf("题卡 %q 不存在", taskID)
	}

	modelRuns, err := s.store.ListModelRuns(taskID)
	if err != nil {
		return nil, err
	}

	targetPaths := collectTraeTargetPaths(task.LocalPath, modelRuns)
	if len(targetPaths) == 0 {
		return &ExtractTaskSessionsResult{
			TaskID:     taskID,
			Candidates: []ExtractTaskSessionCandidate{},
		}, nil
	}

	workspaces, err := discoverMatchedTraeWorkspaces(targetPaths)
	if err != nil {
		return nil, err
	}
	if len(workspaces) == 0 {
		return &ExtractTaskSessionsResult{
			TaskID:     taskID,
			Candidates: []ExtractTaskSessionCandidate{},
		}, nil
	}

	rawSessionIDs := make(map[string]struct{})
	for _, workspace := range workspaces {
		for _, rawSession := range workspace.State.RawSessions {
			if rawSession.RawSessionID == "" {
				continue
			}
			rawSessionIDs[rawSession.RawSessionID] = struct{}{}
		}
	}

	traceRecordsByRaw, err := collectTraeTraceRecordsFromSystem(rawSessionIDs)
	if err != nil {
		return nil, err
	}

	candidates := buildTraeCandidates(workspaces, traceRecordsByRaw)
	return &ExtractTaskSessionsResult{
		TaskID:     taskID,
		Candidates: candidates,
	}, nil
}

func collectTraeTargetPaths(taskLocalPath *string, modelRuns []store.ModelRun) []string {
	seen := make(map[string]struct{})
	targetPaths := make([]string, 0, len(modelRuns)+1)

	appendUnique := func(rawPath *string) {
		if rawPath == nil {
			return
		}
		normalized := normalizeTraePath(*rawPath)
		if normalized == "" {
			return
		}
		if _, exists := seen[normalized]; exists {
			return
		}
		seen[normalized] = struct{}{}
		targetPaths = append(targetPaths, normalized)
	}

	appendUnique(taskLocalPath)
	for _, modelRun := range modelRuns {
		appendUnique(modelRun.LocalPath)
	}

	return targetPaths
}

func normalizeTraePath(rawPath string) string {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return ""
	}
	expanded := util.ExpandTilde(trimmed)
	if !filepath.IsAbs(expanded) {
		if absPath, err := filepath.Abs(expanded); err == nil {
			expanded = absPath
		}
	}
	return filepath.Clean(expanded)
}

func discoverMatchedTraeWorkspaces(targetPaths []string) ([]traeMatchedWorkspace, error) {
	workspaceBase, err := traeWorkspaceStorageBase()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(workspaceBase)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	matches := make([]traeMatchedWorkspace, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		workspaceDir := filepath.Join(workspaceBase, entry.Name())
		workspaceJSONPath := filepath.Join(workspaceDir, "workspace.json")
		stateDBPath := filepath.Join(workspaceDir, "state.vscdb")

		if !fileExists(workspaceJSONPath) || !fileExists(stateDBPath) {
			continue
		}

		workspacePath, err := readTraeWorkspaceFolder(workspaceJSONPath)
		if err != nil || workspacePath == "" {
			continue
		}

		matchedPath, matchKind, matchScore, ok := bestTraeWorkspacePathMatch(workspacePath, targetPaths)
		if !ok {
			continue
		}

		state, err := loadTraeWorkspaceState(stateDBPath)
		if err != nil || len(state.RawSessions) == 0 {
			continue
		}

		matches = append(matches, traeMatchedWorkspace{
			WorkspaceHash: entry.Name(),
			WorkspacePath: workspacePath,
			MatchedPath:   matchedPath,
			MatchKind:     matchKind,
			MatchScore:    matchScore,
			StateDBPath:   stateDBPath,
			State:         state,
		})
	}

	sort.SliceStable(matches, func(i, j int) bool {
		if matches[i].MatchScore != matches[j].MatchScore {
			return matches[i].MatchScore > matches[j].MatchScore
		}
		if matches[i].MatchedPath != matches[j].MatchedPath {
			return matches[i].MatchedPath < matches[j].MatchedPath
		}
		return matches[i].WorkspacePath < matches[j].WorkspacePath
	})

	return matches, nil
}

func traeWorkspaceStorageBase() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, traeWorkspaceStorageRelativePath), nil
}

func traeLogsBase() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, traeLogsRelativePath), nil
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func readTraeWorkspaceFolder(workspaceJSONPath string) (string, error) {
	content, err := os.ReadFile(workspaceJSONPath)
	if err != nil {
		return "", err
	}

	var payload traeWorkspaceJSON
	if err := json.Unmarshal(content, &payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Folder) == "" {
		return "", nil
	}

	decoded := strings.TrimSpace(payload.Folder)
	if parsed, err := url.Parse(decoded); err == nil && parsed.Scheme == "file" {
		pathValue, pathErr := url.PathUnescape(parsed.Path)
		if pathErr == nil {
			return normalizeTraePath(pathValue), nil
		}
	}
	if strings.HasPrefix(decoded, "file://") {
		pathValue, pathErr := url.PathUnescape(strings.TrimPrefix(decoded, "file://"))
		if pathErr == nil {
			return normalizeTraePath(pathValue), nil
		}
	}
	return normalizeTraePath(decoded), nil
}

func bestTraeWorkspacePathMatch(workspacePath string, targetPaths []string) (string, string, int, bool) {
	normalizedWorkspace := normalizeTraePath(workspacePath)
	if normalizedWorkspace == "" {
		return "", "", 0, false
	}

	bestMatchedPath := ""
	bestKind := ""
	bestScore := 0
	bestDistance := 1 << 30

	for _, targetPath := range targetPaths {
		normalizedTarget := normalizeTraePath(targetPath)
		if normalizedTarget == "" {
			continue
		}

		switch {
		case util.SamePath(normalizedWorkspace, normalizedTarget):
			distance := 0
			if bestScore < 300 || (bestScore == 300 && distance < bestDistance) {
				bestMatchedPath = normalizedTarget
				bestKind = "exact"
				bestScore = 300
				bestDistance = distance
			}
		case isSameOrChildPath(normalizedWorkspace, normalizedTarget):
			distance := pathDepth(normalizedWorkspace) - pathDepth(normalizedTarget)
			if bestScore < 200 || (bestScore == 200 && distance < bestDistance) {
				bestMatchedPath = normalizedTarget
				bestKind = "child"
				bestScore = 200
				bestDistance = distance
			}
		case isSameOrChildPath(normalizedTarget, normalizedWorkspace):
			distance := pathDepth(normalizedTarget) - pathDepth(normalizedWorkspace)
			if bestScore < 100 || (bestScore == 100 && distance < bestDistance) {
				bestMatchedPath = normalizedTarget
				bestKind = "parent"
				bestScore = 100
				bestDistance = distance
			}
		}
	}

	return bestMatchedPath, bestKind, bestScore, bestMatchedPath != ""
}

func isSameOrChildPath(pathValue, maybeParent string) bool {
	normalizedPath := normalizeTraePath(pathValue)
	normalizedParent := normalizeTraePath(maybeParent)
	if normalizedPath == "" || normalizedParent == "" {
		return false
	}
	if util.SamePath(normalizedPath, normalizedParent) {
		return true
	}

	parentPrefix := normalizedParent
	if !strings.HasSuffix(parentPrefix, string(os.PathSeparator)) {
		parentPrefix += string(os.PathSeparator)
	}
	return strings.HasPrefix(normalizedPath, parentPrefix)
}

func pathDepth(pathValue string) int {
	normalized := normalizeTraePath(pathValue)
	if normalized == "" {
		return 0
	}
	count := 0
	for _, part := range strings.Split(normalized, string(os.PathSeparator)) {
		if part != "" {
			count++
		}
	}
	return count
}

func loadTraeWorkspaceState(stateDBPath string) (traeWorkspaceState, error) {
	state := traeWorkspaceState{}

	db, err := sql.Open("sqlite", stateDBPath)
	if err != nil {
		return state, err
	}
	defer db.Close()

	db.SetMaxOpenConns(1)

	userKey, err := queryOptionalSQLiteString(db, "SELECT key FROM ItemTable WHERE key LIKE '%_ai-chat:%' LIMIT 1")
	if err != nil {
		return state, err
	}
	if matches := traeWorkspaceUserIDPattern.FindStringSubmatch(userKey); len(matches) == 2 {
		state.UserID = matches[1]
	}

	rawMemento, err := queryOptionalSQLiteString(db, "SELECT value FROM ItemTable WHERE key='memento/icube-ai-agent-storage'")
	if err != nil {
		return state, err
	}
	if strings.TrimSpace(rawMemento) != "" {
		var memento traeWorkspaceMemento
		if err := json.Unmarshal([]byte(rawMemento), &memento); err == nil {
			state.CurrentRawSessionID = strings.TrimSpace(memento.CurrentSessionID)
			seen := make(map[string]struct{})
			for _, item := range memento.List {
				rawSessionID := strings.TrimSpace(item.SessionID)
				if rawSessionID == "" {
					continue
				}
				if _, exists := seen[rawSessionID]; exists {
					continue
				}
				seen[rawSessionID] = struct{}{}
				state.RawSessions = append(state.RawSessions, traeWorkspaceConversation{
					RawSessionID: rawSessionID,
					IsCurrent:    item.IsCurrent || rawSessionID == state.CurrentRawSessionID,
				})
			}
			if state.CurrentRawSessionID != "" {
				if _, exists := seen[state.CurrentRawSessionID]; !exists {
					state.RawSessions = append(state.RawSessions, traeWorkspaceConversation{
						RawSessionID: state.CurrentRawSessionID,
						IsCurrent:    true,
					})
				}
			}
		}
	}

	rawInputHistory, err := queryOptionalSQLiteString(db, "SELECT value FROM ItemTable WHERE key='icube-ai-agent-storage-input-history'")
	if err != nil {
		return state, err
	}
	if strings.TrimSpace(rawInputHistory) != "" {
		var history []traeInputHistoryItem
		if err := json.Unmarshal([]byte(rawInputHistory), &history); err == nil {
			for _, item := range history {
				state.InputHistory = append(state.InputHistory, strings.TrimSpace(item.InputText))
			}
		}
	}

	return state, nil
}

func queryOptionalSQLiteString(db *sql.DB, query string, args ...any) (string, error) {
	var value sql.NullString
	err := db.QueryRow(query, args...).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !value.Valid {
		return "", nil
	}
	return value.String, nil
}

func collectTraeTraceRecordsFromSystem(rawSessionIDs map[string]struct{}) (map[string][]traeTraceRecord, error) {
	logFiles, err := traeLogFiles()
	if err != nil {
		return nil, err
	}
	if len(logFiles) == 0 {
		return map[string][]traeTraceRecord{}, nil
	}
	return collectTraeTraceRecords(logFiles, rawSessionIDs)
}

func traeLogFiles() ([]string, error) {
	logsBase, err := traeLogsBase()
	if err != nil {
		return nil, err
	}
	pattern := filepath.Join(logsBase, "*/Modular/ai-agent_*_stdout.log")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	return files, nil
}

func collectTraeTraceRecords(logFiles []string, rawSessionIDs map[string]struct{}) (map[string][]traeTraceRecord, error) {
	if len(rawSessionIDs) == 0 {
		return map[string][]traeTraceRecord{}, nil
	}

	traceToRawSession := make(map[string]string)
	relevantTraceIDs := make(map[string]struct{})

	for _, logFile := range logFiles {
		err := scanTraeLogFile(logFile, func(line string) {
			traceID := extractTraeTraceID(line)
			if traceID == "" {
				return
			}
			rawSessionID := extractAllowedRawSessionID(line, rawSessionIDs)
			if rawSessionID == "" {
				return
			}
			if _, exists := traceToRawSession[traceID]; !exists {
				traceToRawSession[traceID] = rawSessionID
			}
			relevantTraceIDs[traceID] = struct{}{}
		})
		if err != nil {
			return nil, err
		}
	}

	recordsByTrace := make(map[string]*traeTraceRecord)
	for _, logFile := range logFiles {
		err := scanTraeLogFile(logFile, func(line string) {
			traceID := extractTraeTraceID(line)
			if traceID == "" {
				return
			}

			rawSessionID, exists := traceToRawSession[traceID]
			if !exists {
				return
			}
			if _, relevant := relevantTraceIDs[traceID]; !relevant {
				return
			}

			record, exists := recordsByTrace[traceID]
			if !exists {
				record = &traeTraceRecord{
					TraceID:      traceID,
					RawSessionID: rawSessionID,
				}
				recordsByTrace[traceID] = record
			}

			if !record.HasChatStart && strings.Contains(line, `service: "chat", method: "chat"`) {
				record.HasChatStart = true
				if timestamp, ok := extractTraeTimestamp(line); ok {
					record.Timestamp = timestamp
				}
			}

			if record.UserMessageID == "" && strings.Contains(line, "[ChatService] create message") {
				if matches := traeCreateMessageIDPattern.FindStringSubmatch(line); len(matches) == 2 {
					record.UserMessageID = matches[1]
				}
			}

			if record.AssistantMessageID == "" && strings.Contains(line, "task_id=") {
				if matches := traeAssistantTaskMessageIDPattern.FindStringSubmatch(line); len(matches) == 2 {
					record.AssistantMessageID = matches[1]
				}
			}

			if record.UserMessageID == "" {
				if matches := traeUserMessageIDFallbackPattern.FindStringSubmatch(line); len(matches) == 2 {
					record.UserMessageID = matches[1]
				}
			}
		})
		if err != nil {
			return nil, err
		}
	}

	recordsByRaw := make(map[string][]traeTraceRecord)
	for _, record := range recordsByTrace {
		if record.RawSessionID == "" || !record.HasChatStart {
			continue
		}
		if record.AssistantMessageID == "" || record.UserMessageID == "" || record.Timestamp.IsZero() {
			continue
		}
		recordsByRaw[record.RawSessionID] = append(recordsByRaw[record.RawSessionID], *record)
	}

	for rawSessionID := range recordsByRaw {
		sort.SliceStable(recordsByRaw[rawSessionID], func(i, j int) bool {
			left := recordsByRaw[rawSessionID][i]
			right := recordsByRaw[rawSessionID][j]
			if !left.Timestamp.Equal(right.Timestamp) {
				return left.Timestamp.Before(right.Timestamp)
			}
			return left.TraceID < right.TraceID
		})
	}

	return recordsByRaw, nil
}

func scanTraeLogFile(logFile string, handleLine func(line string)) error {
	file, err := os.Open(logFile)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		handleLine(scanner.Text())
	}
	return scanner.Err()
}

func extractTraeTraceID(line string) string {
	matches := traeTraceIDPattern.FindStringSubmatch(line)
	if len(matches) != 2 {
		return ""
	}
	return matches[1]
}

func extractAllowedRawSessionID(line string, allowed map[string]struct{}) string {
	matches := traeSessionLikePattern.FindAllStringSubmatch(line, -1)
	for _, match := range matches {
		if len(match) != 2 {
			continue
		}
		if _, exists := allowed[match[1]]; exists {
			return match[1]
		}
	}
	return ""
}

func extractTraeTimestamp(line string) (time.Time, bool) {
	matches := traeTimestampPattern.FindStringSubmatch(line)
	if len(matches) != 2 {
		return time.Time{}, false
	}
	if timestamp, err := time.Parse(time.RFC3339Nano, matches[1]); err == nil {
		return timestamp, true
	}
	if timestamp, err := time.Parse("2006-01-02T15:04:05", matches[1]); err == nil {
		return timestamp, true
	}
	return time.Time{}, false
}

func buildTraeCandidates(workspaces []traeMatchedWorkspace, traceRecordsByRaw map[string][]traeTraceRecord) []ExtractTaskSessionCandidate {
	built := make([]traeCandidateBuild, 0)

	for _, workspace := range workspaces {
		if workspace.State.UserID == "" {
			continue
		}

		mappedTurnsByRaw := mapTraeInputHistoryToTurns(workspace.State, traceRecordsByRaw)
		seenRawSessions := make(map[string]struct{})
		for _, rawSession := range workspace.State.RawSessions {
			rawSessionID := rawSession.RawSessionID
			if rawSessionID == "" {
				continue
			}
			if _, exists := seenRawSessions[rawSessionID]; exists {
				continue
			}
			seenRawSessions[rawSessionID] = struct{}{}

			turns := filterMeaningfulTraeTurns(mappedTurnsByRaw[rawSessionID])
			if len(turns) == 0 {
				continue
			}

			extractedSessions := make([]ExtractedTraeSession, 0, len(turns))
			for index, turn := range turns {
				extractedSessions = append(extractedSessions, buildExtractedTraeSession(
					workspace.State.UserID,
					rawSessionID,
					turn,
					(rawSession.IsCurrent || rawSessionID == workspace.State.CurrentRawSessionID) && index == len(turns)-1,
				))
			}

			lastActivityAt := extractedSessions[len(extractedSessions)-1].LastActivityAt
			built = append(built, traeCandidateBuild{
				Candidate: ExtractTaskSessionCandidate{
					ID:               fmt.Sprintf("%s:%s", workspace.WorkspaceHash, rawSessionID),
					WorkspacePath:    workspace.WorkspacePath,
					MatchedPath:      workspace.MatchedPath,
					MatchKind:        workspace.MatchKind,
					SessionCount:     len(extractedSessions),
					UserID:           workspace.State.UserID,
					CurrentSessionID: workspace.State.CurrentRawSessionID,
					UserMessageCount: len(extractedSessions),
					Summary:          summarizeTraeTurns(turns),
					LastActivityAt:   lastActivityAt,
					Sessions:         extractedSessions,
				},
				MatchScore: workspace.MatchScore,
				IsCurrent:  rawSession.IsCurrent || rawSessionID == workspace.State.CurrentRawSessionID,
			})
		}
	}

	sort.SliceStable(built, func(i, j int) bool {
		if built[i].MatchScore != built[j].MatchScore {
			return built[i].MatchScore > built[j].MatchScore
		}
		if built[i].IsCurrent != built[j].IsCurrent {
			return built[i].IsCurrent
		}
		leftAt := int64(0)
		if built[i].Candidate.LastActivityAt != nil {
			leftAt = *built[i].Candidate.LastActivityAt
		}
		rightAt := int64(0)
		if built[j].Candidate.LastActivityAt != nil {
			rightAt = *built[j].Candidate.LastActivityAt
		}
		if leftAt != rightAt {
			return leftAt > rightAt
		}
		if built[i].Candidate.SessionCount != built[j].Candidate.SessionCount {
			return built[i].Candidate.SessionCount > built[j].Candidate.SessionCount
		}
		if built[i].Candidate.WorkspacePath != built[j].Candidate.WorkspacePath {
			return built[i].Candidate.WorkspacePath < built[j].Candidate.WorkspacePath
		}
		return built[i].Candidate.ID < built[j].Candidate.ID
	})

	candidates := make([]ExtractTaskSessionCandidate, 0, len(built))
	for _, item := range built {
		candidates = append(candidates, item.Candidate)
	}
	return candidates
}

func mapTraeInputHistoryToTurns(state traeWorkspaceState, traceRecordsByRaw map[string][]traeTraceRecord) map[string][]traeMappedTurn {
	grouped := make(map[string][]*traeMappedTurn)
	allTurns := make([]*traeMappedTurn, 0)
	seenRawSessions := make(map[string]struct{})

	for _, rawSession := range state.RawSessions {
		rawSessionID := rawSession.RawSessionID
		if rawSessionID == "" {
			continue
		}
		if _, exists := seenRawSessions[rawSessionID]; exists {
			continue
		}
		seenRawSessions[rawSessionID] = struct{}{}

		for _, record := range traceRecordsByRaw[rawSessionID] {
			turn := &traeMappedTurn{Record: record}
			grouped[rawSessionID] = append(grouped[rawSessionID], turn)
			allTurns = append(allTurns, turn)
		}
	}

	sort.SliceStable(allTurns, func(i, j int) bool {
		left := allTurns[i].Record
		right := allTurns[j].Record
		if !left.Timestamp.Equal(right.Timestamp) {
			return left.Timestamp.Before(right.Timestamp)
		}
		if left.RawSessionID != right.RawSessionID {
			return left.RawSessionID < right.RawSessionID
		}
		return left.TraceID < right.TraceID
	})

	for index, inputText := range state.InputHistory {
		if index >= len(allTurns) {
			break
		}
		allTurns[index].UserConversation = strings.TrimSpace(inputText)
	}

	result := make(map[string][]traeMappedTurn, len(grouped))
	for rawSessionID, turns := range grouped {
		result[rawSessionID] = make([]traeMappedTurn, 0, len(turns))
		for _, turn := range turns {
			result[rawSessionID] = append(result[rawSessionID], *turn)
		}
	}
	return result
}

func filterMeaningfulTraeTurns(turns []traeMappedTurn) []traeMappedTurn {
	if len(turns) == 0 {
		return nil
	}

	filtered := make([]traeMappedTurn, 0, len(turns))
	firstConversation := strings.TrimSpace(turns[0].UserConversation)
	for index, turn := range turns {
		text := strings.TrimSpace(turn.UserConversation)
		if index > 0 && text != "" && isTraeNoiseMessage(text, firstConversation) {
			continue
		}
		filtered = append(filtered, turn)
	}
	return filtered
}

func isTraeNoiseMessage(text, firstConversation string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if firstConversation != "" && trimmed == firstConversation {
		return true
	}
	for _, pattern := range traeNoiseMessagePatterns {
		if pattern.MatchString(trimmed) {
			return true
		}
	}
	return false
}

func buildExtractedTraeSession(userID, rawSessionID string, turn traeMappedTurn, isCurrent bool) ExtractedTraeSession {
	sessionID := buildTraeFullSessionID(
		userID,
		turn.Record.TraceID,
		rawSessionID,
		turn.Record.AssistantMessageID,
		turn.Record.UserMessageID,
		turn.Record.Timestamp,
	)

	var lastActivityAt *int64
	if !turn.Record.Timestamp.IsZero() {
		timestamp := turn.Record.Timestamp.Unix()
		lastActivityAt = &timestamp
	}

	userConversation := strings.TrimSpace(turn.UserConversation)
	return ExtractedTraeSession{
		SessionID:        sessionID,
		UserConversation: userConversation,
		UserMessageCount: 1,
		FirstUserMessage: userConversation,
		LastActivityAt:   lastActivityAt,
		IsCurrent:        isCurrent,
	}
}

func buildTraeFullSessionID(userID, traceID, rawSessionID, assistantMessageID, userMessageID string, timestamp time.Time) string {
	return fmt.Sprintf(
		".%s:%s_%s.%s.%s:Trae CN.T(%s)",
		userID,
		traceID,
		rawSessionID,
		assistantMessageID,
		userMessageID,
		formatTraeTimestamp(timestamp),
	)
}

func formatTraeTimestamp(timestamp time.Time) string {
	if timestamp.IsZero() {
		return ""
	}
	return fmt.Sprintf(
		"%d/%d/%d %d:%02d:%02d",
		timestamp.Year(),
		int(timestamp.Month()),
		timestamp.Day(),
		timestamp.Hour(),
		timestamp.Minute(),
		timestamp.Second(),
	)
}

func summarizeTraeTurns(turns []traeMappedTurn) string {
	for _, turn := range turns {
		text := strings.TrimSpace(turn.UserConversation)
		if text == "" {
			continue
		}
		return truncateTraeSummary(text, 120)
	}
	return "未提取到对话摘要"
}

func truncateTraeSummary(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(strings.TrimSpace(text))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit]) + "…"
}
