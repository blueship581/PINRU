package task

import (
	"testing"

	"github.com/blueship581/pinru/internal/store"
)

func TestBuildTaskSessionsFromCandidatePreservesReviewFieldsAndEvidence(t *testing.T) {
	candidate := ExtractTaskSessionCandidate{
		ID:            "candidate-1",
		WorkspacePath: "/tmp/workspace",
		MatchedPath:   "/tmp/workspace/task",
		MatchKind:     "peer_model",
		UserID:        "u-1001",
		Username:      "alice",
		Summary:       "最近一次执行会话",
		Sessions: []ExtractedTraeSession{
			{
				SessionID:        "sess-1",
				UserConversation: "conv-1",
				LastActivityAt:   int64Ptr(1712345678),
				IsCurrent:        false,
			},
			{
				SessionID:        "sess-2",
				UserConversation: "conv-2",
				LastActivityAt:   int64Ptr(1712345789),
				IsCurrent:        true,
			},
		},
	}

	previousSessions := []store.TaskSession{
		{
			SessionID:        "old-1",
			TaskType:         "Bug修复",
			ConsumeQuota:     true,
			IsCompleted:      boolPtr(true),
			IsSatisfied:      boolPtr(true),
			Evaluation:       "old-eval",
			UserConversation: "old-conv-1",
		},
		{
			SessionID:        "old-2",
			TaskType:         "代码测试",
			ConsumeQuota:     false,
			IsCompleted:      boolPtr(false),
			IsSatisfied:      boolPtr(false),
			Evaluation:       "needs work",
			UserConversation: "old-conv-2",
		},
	}

	sessions := buildTaskSessionsFromCandidate(candidate, previousSessions, "Feature迭代")
	if len(sessions) != 2 {
		t.Fatalf("len(sessions) = %d, want 2", len(sessions))
	}

	if sessions[0].TaskType != "Bug修复" {
		t.Fatalf("sessions[0].TaskType = %q, want Bug修复", sessions[0].TaskType)
	}
	if sessions[0].ConsumeQuota != true {
		t.Fatalf("sessions[0].ConsumeQuota = %v, want true", sessions[0].ConsumeQuota)
	}
	if sessions[0].IsCompleted == nil || !*sessions[0].IsCompleted {
		t.Fatalf("sessions[0].IsCompleted = %v, want true", sessions[0].IsCompleted)
	}
	if sessions[0].Evaluation != "old-eval" {
		t.Fatalf("sessions[0].Evaluation = %q, want old-eval", sessions[0].Evaluation)
	}
	if sessions[0].UserConversation != "conv-1" {
		t.Fatalf("sessions[0].UserConversation = %q, want conv-1", sessions[0].UserConversation)
	}
	if sessions[0].Evidence == nil {
		t.Fatalf("sessions[0].Evidence = nil, want populated evidence")
	}
	if sessions[0].Evidence.Username != "alice" {
		t.Fatalf("sessions[0].Evidence.Username = %q, want alice", sessions[0].Evidence.Username)
	}
	if sessions[0].Evidence.WorkspacePath != "/tmp/workspace" {
		t.Fatalf("sessions[0].Evidence.WorkspacePath = %q, want /tmp/workspace", sessions[0].Evidence.WorkspacePath)
	}
	if sessions[0].Evidence.ExtractedAt == nil {
		t.Fatalf("sessions[0].Evidence.ExtractedAt = nil, want timestamp")
	}

	if sessions[1].TaskType != "代码测试" {
		t.Fatalf("sessions[1].TaskType = %q, want 代码测试", sessions[1].TaskType)
	}
	if sessions[1].ConsumeQuota != false {
		t.Fatalf("sessions[1].ConsumeQuota = %v, want false", sessions[1].ConsumeQuota)
	}
	if sessions[1].IsCompleted == nil || *sessions[1].IsCompleted {
		t.Fatalf("sessions[1].IsCompleted = %v, want false", sessions[1].IsCompleted)
	}
	if sessions[1].Evidence == nil || !sessions[1].Evidence.IsCurrent {
		t.Fatalf("sessions[1].Evidence.IsCurrent = %v, want true", sessions[1].Evidence)
	}
}

func int64Ptr(value int64) *int64 {
	next := value
	return &next
}
