package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestBuildTraeFullSessionIDUsesExpectedOrder(t *testing.T) {
	timestamp := time.Date(2026, 4, 9, 15, 56, 9, 0, time.FixedZone("CST", 8*60*60))

	got := buildTraeFullSessionID(
		"2807478737174707",
		"425b46f7291ae57e9580393d504323a8",
		"69d75ab62e5c1a5d3b3cd93f",
		"69d75b992e5c1a5d3b3cda42",
		"69d75b9920e60c0a9b46f208",
		timestamp,
	)

	want := ".2807478737174707:425b46f7291ae57e9580393d504323a8_69d75ab62e5c1a5d3b3cd93f.69d75b992e5c1a5d3b3cda42.69d75b9920e60c0a9b46f208:Trae CN.T(2026/4/9 15:56:09)"
	if got != want {
		t.Fatalf("buildTraeFullSessionID() = %q, want %q", got, want)
	}
}

func TestCollectTraeTraceRecordsKeepsMultipleTurnsUnderSingleRawSession(t *testing.T) {
	rawSessionID := "69d75ab62e5c1a5d3b3cd93f"
	logDir := filepath.Join(t.TempDir(), "20260409T151439", "Modular")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	logFile := filepath.Join(logDir, "ai-agent_0_stdout.log")
	logLines := []string{
		`2026-04-09T15:56:09.831196+08:00  INFO process_ipc_request: ai_agent::infrastructure::towel::rpc: [RPC] process_ipc_request called!, channel_id: a, trace_id: 425b46f7291ae57e9580393d504323a8, service: "chat", method: "chat" trace_id="425b46f7291ae57e9580393d504323a8"`,
		`2026-04-09T15:56:09.831498+08:00  INFO process_ipc_request:route:chat: ai_agent::domain::chat::service: [ChatService] chat start at 1775721369831 trace_id="425b46f7291ae57e9580393d504323a8" session_id=69d75ab62e5c1a5d3b3cd93f`,
		`2026-04-09T15:56:09.836768+08:00  INFO process_ipc_request:route:chat: ai_agent::domain::chat::service: [ChatService] create message, chat_session_id: 69d75ab62e5c1a5d3b3cd93f, message_id: 69d75b9920e60c0a9b46f208 trace_id="425b46f7291ae57e9580393d504323a8" session_id=69d75ab62e5c1a5d3b3cd93f`,
		`2026-04-09T15:56:10.000000+08:00  INFO process_ipc_request:route:chat: ai_agent::domain::task::cloud_service: TASK: task_id=69d75b992e5c1a5d3b3cda43,session_id=69d75ab62e5c1a5d3b3cd93f,message_id=69d75b992e5c1a5d3b3cda42,status=Completed trace_id="425b46f7291ae57e9580393d504323a8" session_id=69d75ab62e5c1a5d3b3cd93f`,
		`2026-04-09T16:31:13.066503+08:00  INFO process_ipc_request: ai_agent::infrastructure::towel::rpc: [RPC] process_ipc_request called!, channel_id: b, trace_id: 0aab1c2f7e23c63b1a82a25639b06d45, service: "chat", method: "chat" trace_id="0aab1c2f7e23c63b1a82a25639b06d45"`,
		`2026-04-09T16:31:13.070000+08:00  INFO process_ipc_request:route:chat: ai_agent::domain::chat::service: [ChatService] chat start at 1775723473066 trace_id="0aab1c2f7e23c63b1a82a25639b06d45" session_id=69d75ab62e5c1a5d3b3cd93f`,
		`2026-04-09T16:31:13.072000+08:00  INFO process_ipc_request:route:chat: ai_agent::domain::chat::service: [ChatService] create message, chat_session_id: 69d75ab62e5c1a5d3b3cd93f, message_id: 69d763d020e60c0a9b46f209 trace_id="0aab1c2f7e23c63b1a82a25639b06d45" session_id=69d75ab62e5c1a5d3b3cd93f`,
		`2026-04-09T16:32:31.758732+08:00  INFO process_ipc_request:route:chat:slardar_root:dispatch: ai_agent::domain::task::cloud_service: TASK: task_id=69d763d12e5c1a5d3b3cdb53,session_id=69d75ab62e5c1a5d3b3cd93f,message_id=69d763d12e5c1a5d3b3cdb52,status=Completed trace_id="0aab1c2f7e23c63b1a82a25639b06d45" session_id=69d75ab62e5c1a5d3b3cd93f`,
	}

	if err := os.WriteFile(logFile, []byte(strings.Join(logLines, "\n")+"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	recordsByRaw, err := collectTraeTraceRecords([]string{logFile}, map[string]struct{}{rawSessionID: {}})
	if err != nil {
		t.Fatalf("collectTraeTraceRecords() error = %v", err)
	}

	records := recordsByRaw[rawSessionID]
	if len(records) != 2 {
		t.Fatalf("trace count = %d, want 2", len(records))
	}
	if records[0].TraceID != "425b46f7291ae57e9580393d504323a8" {
		t.Fatalf("first trace = %q, want round 1 trace", records[0].TraceID)
	}
	if records[1].TraceID != "0aab1c2f7e23c63b1a82a25639b06d45" {
		t.Fatalf("second trace = %q, want round 2 trace", records[1].TraceID)
	}
	if records[0].AssistantMessageID != "69d75b992e5c1a5d3b3cda42" || records[0].UserMessageID != "69d75b9920e60c0a9b46f208" {
		t.Fatalf("round 1 ids mismatch: %+v", records[0])
	}
	if records[1].AssistantMessageID != "69d763d12e5c1a5d3b3cdb52" || records[1].UserMessageID != "69d763d020e60c0a9b46f209" {
		t.Fatalf("round 2 ids mismatch: %+v", records[1])
	}
}

func TestBuildTraeCandidatesAssignsInputHistoryChronologically(t *testing.T) {
	rawSessionID := "69d75ab62e5c1a5d3b3cd93f"
	userID := "2807478737174707"

	traceRecordsByRaw := map[string][]traeTraceRecord{
		rawSessionID: {
			{
				TraceID:            "425b46f7291ae57e9580393d504323a8",
				RawSessionID:       rawSessionID,
				AssistantMessageID: "69d75b992e5c1a5d3b3cda42",
				UserMessageID:      "69d75b9920e60c0a9b46f208",
				Timestamp:          time.Date(2026, 4, 9, 15, 56, 9, 0, time.FixedZone("CST", 8*60*60)),
				HasChatStart:       true,
			},
			{
				TraceID:            "0aab1c2f7e23c63b1a82a25639b06d45",
				RawSessionID:       rawSessionID,
				AssistantMessageID: "69d763d12e5c1a5d3b3cdb52",
				UserMessageID:      "69d763d020e60c0a9b46f209",
				Timestamp:          time.Date(2026, 4, 9, 16, 31, 13, 0, time.FixedZone("CST", 8*60*60)),
				HasChatStart:       true,
			},
		},
	}

	workspaces := []traeMatchedWorkspace{
		{
			WorkspaceHash: "workspace-1",
			WorkspacePath: "/tmp/demo/label-02892-bug修复/02892-bug修复",
			MatchedPath:   "/tmp/demo/label-02892-bug修复",
			MatchKind:     "child",
			MatchScore:    200,
			State: traeWorkspaceState{
				UserID:              userID,
				CurrentRawSessionID: rawSessionID,
				RawSessions: []traeWorkspaceConversation{
					{RawSessionID: rawSessionID, IsCurrent: true},
				},
				InputHistory: []string{
					"第一轮问题",
					"第二轮问题",
				},
			},
		},
	}

	candidates := buildTraeCandidates(workspaces, traceRecordsByRaw)
	if len(candidates) != 1 {
		t.Fatalf("candidate count = %d, want 1", len(candidates))
	}

	candidate := candidates[0]
	if candidate.SessionCount != 2 {
		t.Fatalf("candidate.SessionCount = %d, want 2", candidate.SessionCount)
	}
	if candidate.UserMessageCount != 2 {
		t.Fatalf("candidate.UserMessageCount = %d, want 2", candidate.UserMessageCount)
	}
	if len(candidate.Sessions) != 2 {
		t.Fatalf("session list len = %d, want 2", len(candidate.Sessions))
	}

	wantFirst := ".2807478737174707:425b46f7291ae57e9580393d504323a8_69d75ab62e5c1a5d3b3cd93f.69d75b992e5c1a5d3b3cda42.69d75b9920e60c0a9b46f208:Trae CN.T(2026/4/9 15:56:09)"
	wantSecond := ".2807478737174707:0aab1c2f7e23c63b1a82a25639b06d45_69d75ab62e5c1a5d3b3cd93f.69d763d12e5c1a5d3b3cdb52.69d763d020e60c0a9b46f209:Trae CN.T(2026/4/9 16:31:13)"
	if candidate.Sessions[0].SessionID != wantFirst {
		t.Fatalf("round 1 sessionId = %q, want %q", candidate.Sessions[0].SessionID, wantFirst)
	}
	if candidate.Sessions[1].SessionID != wantSecond {
		t.Fatalf("round 2 sessionId = %q, want %q", candidate.Sessions[1].SessionID, wantSecond)
	}
	if candidate.Sessions[0].UserConversation != "第一轮问题" {
		t.Fatalf("round 1 conversation = %q, want 第一轮问题", candidate.Sessions[0].UserConversation)
	}
	if candidate.Sessions[1].UserConversation != "第二轮问题" {
		t.Fatalf("round 2 conversation = %q, want 第二轮问题", candidate.Sessions[1].UserConversation)
	}
	if !candidate.Sessions[1].IsCurrent {
		t.Fatalf("expected latest turn to be marked current")
	}
}

func TestExtractTraeRealDataFromEnv(t *testing.T) {
	taskPath := strings.TrimSpace(os.Getenv("PINRU_TRAE_VERIFY_TASK_PATH"))
	expectedFirst := strings.TrimSpace(os.Getenv("PINRU_TRAE_EXPECTED_1"))
	expectedSecond := strings.TrimSpace(os.Getenv("PINRU_TRAE_EXPECTED_2"))
	if taskPath == "" || expectedFirst == "" || expectedSecond == "" {
		t.Skip("set PINRU_TRAE_VERIFY_TASK_PATH, PINRU_TRAE_EXPECTED_1 and PINRU_TRAE_EXPECTED_2 to run real-data verification")
	}

	workspaces, err := discoverMatchedTraeWorkspaces([]string{taskPath})
	if err != nil {
		t.Fatalf("discoverMatchedTraeWorkspaces() error = %v", err)
	}
	if len(workspaces) == 0 {
		t.Fatalf("no matched Trae workspaces found for %q", taskPath)
	}

	rawSessionIDs := make(map[string]struct{})
	for _, workspace := range workspaces {
		for _, rawSession := range workspace.State.RawSessions {
			rawSessionIDs[rawSession.RawSessionID] = struct{}{}
		}
	}

	traceRecordsByRaw, err := collectTraeTraceRecordsFromSystem(rawSessionIDs)
	if err != nil {
		t.Fatalf("collectTraeTraceRecordsFromSystem() error = %v", err)
	}

	candidates := buildTraeCandidates(workspaces, traceRecordsByRaw)
	if len(candidates) == 0 {
		t.Fatalf("no extracted candidates found")
	}

	for _, candidate := range candidates {
		if len(candidate.Sessions) < 2 {
			continue
		}
		if candidate.Sessions[0].SessionID == expectedFirst && candidate.Sessions[1].SessionID == expectedSecond {
			return
		}
	}

	t.Fatalf("did not find candidate with expected session ids; candidates=%+v", candidates)
}
