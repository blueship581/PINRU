package task

import (
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestBestTraeWorkspacePathMatchMatchesCrossRootPeerModel(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Trae workspace path matching uses Unix-style paths; not applicable on Windows")
	}

	workspacePath := "/Users/alice/workspaces/review/label-01849-comparison/cotv21-pro"
	targetPaths := []string{
		"/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-comparison/cotv21-pro",
	}

	matchedPath, matchKind, matchScore, ok := bestTraeWorkspacePathMatch(workspacePath, targetPaths)
	if !ok {
		t.Fatalf("expected cross-root model path to match")
	}
	if matchedPath != targetPaths[0] {
		t.Fatalf("matchedPath = %q, want %q", matchedPath, targetPaths[0])
	}
	if matchKind != "peer_model" {
		t.Fatalf("matchKind = %q, want peer_model", matchKind)
	}
	if matchScore != 170 {
		t.Fatalf("matchScore = %d, want 170", matchScore)
	}
}

func TestBestTraeWorkspacePathMatchMatchesCrossRootPeerTask(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Trae workspace path matching uses Unix-style paths; not applicable on Windows")
	}

	workspacePath := "/Users/alice/workspaces/review/label-01849-bug修复"
	targetPaths := []string{
		"/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-comparison/cotv21-pro",
	}

	matchedPath, matchKind, matchScore, ok := bestTraeWorkspacePathMatch(workspacePath, targetPaths)
	if !ok {
		t.Fatalf("expected cross-root task path to match")
	}
	if matchedPath != targetPaths[0] {
		t.Fatalf("matchedPath = %q, want %q", matchedPath, targetPaths[0])
	}
	if matchKind != "peer_task" {
		t.Fatalf("matchKind = %q, want peer_task", matchKind)
	}
	if matchScore != 150 {
		t.Fatalf("matchScore = %d, want 150", matchScore)
	}
}

func TestCollectTraeTraceRecordsKeepsEarlierTraceDetailsBeforeSessionMapping(t *testing.T) {
	logDir := t.TempDir()
	logFile := filepath.Join(logDir, "ai-agent_stdout.log")
	rawSessionID := "69db73736d34f5e3ac85b387"
	traceID := "664ffceb2a37d8b06f021618f433ea4b"
	userMessageID := "69db73af28fdad7729b17e8c"
	assistantMessageID := "69db73b06d34f5e3ac85b391"

	content := "" +
		"2026-04-12T18:27:59.999999+08:00 INFO route chat trace_id=\"" + traceID + "\" service: \"chat\", method: \"chat\"\n" +
		"2026-04-12T18:28:00.026777+08:00 INFO [ChatService] create message, chat_session_id: " + rawSessionID + ", message_id: " + userMessageID + " trace_id=\"" + traceID + "\" session_id=" + rawSessionID + "\n" +
		"2026-04-12T18:28:00.080631+08:00 INFO generate start trace_id=\"" + traceID + "\" session_id=" + rawSessionID + " task_id=69db73b06d34f5e3ac85b392 message_id=" + assistantMessageID + "\n"
	if err := os.WriteFile(logFile, []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	recordsByRaw, err := collectTraeTraceRecords([]string{logFile}, map[string]struct{}{
		rawSessionID: {},
	})
	if err != nil {
		t.Fatalf("collectTraeTraceRecords() error = %v", err)
	}

	records := recordsByRaw[rawSessionID]
	if len(records) != 1 {
		t.Fatalf("len(records) = %d, want 1", len(records))
	}
	if records[0].TraceID != traceID {
		t.Fatalf("records[0].TraceID = %q, want %q", records[0].TraceID, traceID)
	}
	if records[0].RawSessionID != rawSessionID {
		t.Fatalf("records[0].RawSessionID = %q, want %q", records[0].RawSessionID, rawSessionID)
	}
	if records[0].UserMessageID != userMessageID {
		t.Fatalf("records[0].UserMessageID = %q, want %q", records[0].UserMessageID, userMessageID)
	}
	if records[0].AssistantMessageID != assistantMessageID {
		t.Fatalf("records[0].AssistantMessageID = %q, want %q", records[0].AssistantMessageID, assistantMessageID)
	}
	if records[0].Timestamp.IsZero() {
		t.Fatalf("records[0].Timestamp = zero, want extracted timestamp")
	}
}

func TestPartitionTraeLogFilesByDayPrefersToday(t *testing.T) {
	logDir := t.TempDir()
	todayFile := filepath.Join(logDir, "today.log")
	historyFile := filepath.Join(logDir, "history.log")

	for _, file := range []string{todayFile, historyFile} {
		if err := os.WriteFile(file, []byte("test"), 0o644); err != nil {
			t.Fatalf("WriteFile(%s) error = %v", file, err)
		}
	}

	now := time.Date(2026, time.April, 14, 10, 30, 0, 0, time.Local)
	todayTime := now.Add(-30 * time.Minute)
	historyTime := now.AddDate(0, 0, -2)
	if err := os.Chtimes(todayFile, todayTime, todayTime); err != nil {
		t.Fatalf("Chtimes(today) error = %v", err)
	}
	if err := os.Chtimes(historyFile, historyTime, historyTime); err != nil {
		t.Fatalf("Chtimes(history) error = %v", err)
	}

	today, history := partitionTraeLogFilesByDay([]string{todayFile, historyFile}, now)
	if len(today) != 1 || today[0] != todayFile {
		t.Fatalf("today = %v, want [%s]", today, todayFile)
	}
	if len(history) != 1 || history[0] != historyFile {
		t.Fatalf("history = %v, want [%s]", history, historyFile)
	}
}

func TestLoadTraeWorkspaceStatePrefersCurrentSessionOwnerAcrossMultipleUsers(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "state.vscdb")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`); err != nil {
		t.Fatalf("CREATE TABLE error = %v", err)
	}

	currentRawSessionID := "69de442f6d34f5e3ac85e2fd"
	if err := insertTraeStateRow(db, "memento/icube-ai-agent-storage", `{"list":[{"isCurrent":true,"sessionId":"`+currentRawSessionID+`","messages":[]}],"currentSessionId":"`+currentRawSessionID+`"}`); err != nil {
		t.Fatalf("insert memento error = %v", err)
	}
	if err := insertTraeStateRow(db, "1713494194401290_ai-chat:sessionRelation:planModeMap", `{"69de1f7c6d34f5e3ac85dbd2":false}`); err != nil {
		t.Fatalf("insert legacy user relation error = %v", err)
	}
	if err := insertTraeStateRow(db, "573312257230252_ai-chat:sessionRelation:modelMap", `{"`+currentRawSessionID+`":{"solo_coder":"3_volcengine_volcengine//ep-20260331120931-5lxqv"}}`); err != nil {
		t.Fatalf("insert current user modelMap error = %v", err)
	}
	if err := insertTraeStateRow(db, "573312257230252_ai-chat:sessionRelation:modeMap", `{"`+currentRawSessionID+`":{"solo_coder":0}}`); err != nil {
		t.Fatalf("insert current user modeMap error = %v", err)
	}
	if err := insertTraeStateRow(db, "573312257230252_profile", `{"username":"alice"}`); err != nil {
		t.Fatalf("insert current user profile error = %v", err)
	}

	state, err := loadTraeWorkspaceState(dbPath)
	if err != nil {
		t.Fatalf("loadTraeWorkspaceState() error = %v", err)
	}
	if state.UserID != "573312257230252" {
		t.Fatalf("state.UserID = %q, want 573312257230252", state.UserID)
	}
	if state.Username != "alice" {
		t.Fatalf("state.Username = %q, want alice", state.Username)
	}
	if state.CurrentRawSessionID != currentRawSessionID {
		t.Fatalf("state.CurrentRawSessionID = %q, want %q", state.CurrentRawSessionID, currentRawSessionID)
	}
	if len(state.RawSessions) != 1 || state.RawSessions[0].RawSessionID != currentRawSessionID {
		t.Fatalf("state.RawSessions = %#v, want current raw session only", state.RawSessions)
	}
}

func TestInferTraeWorkspaceUserIDFallsBackToSingleKnownUser(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "state.vscdb")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)`); err != nil {
		t.Fatalf("CREATE TABLE error = %v", err)
	}
	if err := insertTraeStateRow(db, "573312257230252_ai-chat:sessionRelation:globalModelMap", `{"solo_coder":"model"}`); err != nil {
		t.Fatalf("insert globalModelMap error = %v", err)
	}

	userID, err := inferTraeWorkspaceUserID(db, nil, "")
	if err != nil {
		t.Fatalf("inferTraeWorkspaceUserID() error = %v", err)
	}
	if userID != "573312257230252" {
		t.Fatalf("userID = %q, want 573312257230252", userID)
	}
}

func insertTraeStateRow(db *sql.DB, key, value string) error {
	_, err := db.Exec(`INSERT INTO ItemTable (key, value) VALUES (?, ?)`, key, value)
	return err
}
