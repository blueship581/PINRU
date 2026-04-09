import { describe, expect, it } from 'vitest';
import {
  buildDraftsFromExtractedCandidate,
  buildSessionEditorOpenSet,
  countCountedSessions,
  countCountedSessionsByTaskType,
  createSessionDraft,
  formatBooleanSelection,
  hasCountedSessionForTaskType,
  getSessionDecisionBadge,
  hasCountedSubmittedSession,
  hasSessionId,
  hydrateSessionDrafts,
  isSessionCounted,
  mapSessionDraftsToSessionList,
  maskSessionId,
  parseBooleanSelection,
  summarizeCountedRounds,
  type EditableTaskSession,
} from '../lib/sessionUtils';
import type { ExtractTaskSessionCandidate } from '../services/task';

function createEditableSession(
  overrides: Partial<EditableTaskSession> = {},
): EditableTaskSession {
  return {
    localId: overrides.localId ?? `session-${Math.random().toString(36).slice(2)}`,
    sessionId: overrides.sessionId ?? '',
    taskType: overrides.taskType ?? 'Feature迭代',
    consumeQuota: overrides.consumeQuota ?? false,
    isCompleted: overrides.isCompleted ?? null,
    isSatisfied: overrides.isSatisfied ?? null,
    evaluation: overrides.evaluation ?? '',
  };
}

describe('sessionUtils', () => {
  it('creates normalized session drafts with defaults', () => {
    const draft = createSessionDraft('feature', {
      taskType: 'bugfix',
      sessionId: ' sess-1 ',
      consumeQuota: true,
      isCompleted: true,
      isSatisfied: false,
      evaluation: 'fine',
      userConversation: 'hello',
    });

    expect(draft.taskType).toBe('Bug修复');
    expect(draft.sessionId).toBe(' sess-1 ');
    expect(draft.consumeQuota).toBe(true);
    expect(draft.isCompleted).toBe(true);
    expect(draft.isSatisfied).toBe(false);
    expect(draft.evaluation).toBe('fine');
    expect(draft.userConversation).toBe('hello');
    expect(draft.localId).toBeTruthy();
  });

  it('hydrates drafts and opens editors for empty session ids', () => {
    const drafts = hydrateSessionDrafts([
      createEditableSession({ localId: 'a', sessionId: 'sess-1', consumeQuota: true }),
      createEditableSession({ localId: 'b', sessionId: '', consumeQuota: false }),
    ], 'Feature迭代');

    expect(drafts).toHaveLength(2);
    expect(drafts[0].consumeQuota).toBe(true);
    expect(buildSessionEditorOpenSet(drafts)).toEqual(new Set([drafts[1].localId]));
  });

  it('hydrates a fallback draft when no sessions are persisted', () => {
    const drafts = hydrateSessionDrafts(null, '代码测试');

    expect(drafts).toHaveLength(1);
    expect(drafts[0].taskType).toBe('代码测试');
    expect(drafts[0].consumeQuota).toBe(true);
  });

  it('handles session id and counted-session checks', () => {
    expect(hasSessionId({ sessionId: '  sess-1  ' })).toBe(true);
    expect(hasSessionId({ sessionId: '   ' })).toBe(false);
    expect(isSessionCounted({ sessionId: '', consumeQuota: false }, 0)).toBe(true);
    expect(isSessionCounted({ sessionId: '', consumeQuota: true }, 1)).toBe(false);
    expect(isSessionCounted({ sessionId: 'sess-2', consumeQuota: true }, 1)).toBe(true);
    expect(countCountedSessions([
      { sessionId: '', consumeQuota: true, taskType: 'Bug修复' },
      { sessionId: 'sess-2', consumeQuota: true, taskType: 'Feature迭代' },
      { sessionId: '', consumeQuota: true, taskType: '代码测试' },
    ])).toBe(2);
    expect(hasCountedSubmittedSession({
      sessionList: [
        { sessionId: '', taskType: 'Feature迭代', consumeQuota: true },
        { sessionId: '', taskType: 'Bug修复', consumeQuota: true },
      ],
    })).toBe(true);
  });

  it('counts submitted sessions by session task type instead of task primary type', () => {
    const taskPool = [
      {
        status: 'Submitted',
        sessionList: [
          { sessionId: '', taskType: 'Bug修复', consumeQuota: true },
          { sessionId: 'sess-2', taskType: '代码测试', consumeQuota: true },
        ],
      },
      {
        status: 'Claimed',
        sessionList: [
          { sessionId: '', taskType: 'Bug修复', consumeQuota: true },
          { sessionId: 'sess-3', taskType: 'Feature迭代', consumeQuota: true },
        ],
      },
    ];

    expect(countCountedSessionsByTaskType(taskPool)).toEqual({
      Bug修复: 2,
      代码测试: 1,
      Feature迭代: 1,
    });
    expect(countCountedSessionsByTaskType(taskPool, { status: 'Submitted' })).toEqual({
      Bug修复: 1,
      代码测试: 1,
    });
  });

  it('detects whether a task contributes counted sessions to a given task type', () => {
    const task = {
      sessionList: [
        { sessionId: '', taskType: 'Bug修复', consumeQuota: true },
        { sessionId: 'sess-2', taskType: '代码测试', consumeQuota: true },
      ],
    };

    expect(hasCountedSessionForTaskType(task, 'bugfix')).toBe(true);
    expect(hasCountedSessionForTaskType(task, '代码测试')).toBe(true);
    expect(hasCountedSessionForTaskType(task, 'Feature迭代')).toBe(false);
  });

  it('does not count non-primary sessions with empty sessionId', () => {
    const sessions = [
      createEditableSession({ sessionId: 'sess-1', consumeQuota: true }),
      createEditableSession({ sessionId: '', consumeQuota: true }),
    ];

    expect(summarizeCountedRounds(sessions)).toBe('计数轮次：第1轮');
  });

  it('always counts the first round even when sessionId is empty', () => {
    const sessions = [
      createEditableSession({ sessionId: '', consumeQuota: true }),
      createEditableSession({ sessionId: '', consumeQuota: false }),
    ];

    expect(summarizeCountedRounds(sessions)).toBe('计数轮次：第1轮');
  });

  it('summarizes mixed multi-round counting correctly', () => {
    const sessions = [
      createEditableSession({ sessionId: '', consumeQuota: true }),
      createEditableSession({ sessionId: 'sess-2', consumeQuota: true }),
      createEditableSession({ sessionId: 'sess-3', consumeQuota: false }),
      createEditableSession({ sessionId: '', consumeQuota: true }),
    ];

    expect(summarizeCountedRounds(sessions)).toBe('计数轮次：第1轮、第2轮'.replace(',', '、'));
  });

  it('maps consumeQuota to false when a non-primary sessionId is empty', () => {
    const sessions = [
      createEditableSession({ sessionId: '', taskType: 'Bug修复', consumeQuota: true, isCompleted: true, isSatisfied: true }),
      createEditableSession({ sessionId: '  ', taskType: 'Feature迭代', consumeQuota: true, isCompleted: false, isSatisfied: false }),
      createEditableSession({ sessionId: 'sess-3', taskType: '代码测试', consumeQuota: true, isCompleted: true, isSatisfied: true, evaluation: ' ok ' }),
    ];

    expect(mapSessionDraftsToSessionList(sessions, 'Feature迭代')).toEqual([
      {
        sessionId: '',
        taskType: 'Bug修复',
        consumeQuota: true,
        isCompleted: true,
        isSatisfied: true,
        evaluation: '',
        userConversation: '',
      },
      {
        sessionId: '',
        taskType: 'Feature迭代',
        consumeQuota: false,
        isCompleted: false,
        isSatisfied: false,
        evaluation: '',
        userConversation: '',
      },
      {
        sessionId: 'sess-3',
        taskType: '代码测试',
        consumeQuota: true,
        isCompleted: true,
        isSatisfied: true,
        evaluation: 'ok',
        userConversation: '',
      },
    ]);
  });

  it('builds drafts from an extracted Trae candidate while preserving existing decisions', () => {
    const candidate: ExtractTaskSessionCandidate = {
      id: 'candidate-1',
      workspacePath: '/tmp/workspace',
      matchedPath: '/tmp/workspace/task',
      matchKind: 'exact',
      sessionCount: 2,
      userId: 'u1',
      currentSessionId: 'sess-2',
      userMessageCount: 5,
      summary: 'summary',
      lastActivityAt: 123,
      sessions: [
        {
          sessionId: 'sess-1',
          userConversation: 'conv-1',
          userMessageCount: 2,
          firstUserMessage: 'hello',
          lastActivityAt: 111,
          isCurrent: false,
        },
        {
          sessionId: 'sess-2',
          userConversation: 'conv-2',
          userMessageCount: 3,
          firstUserMessage: 'world',
          lastActivityAt: 123,
          isCurrent: true,
        },
      ],
    };

    const drafts = buildDraftsFromExtractedCandidate(candidate, [
      createEditableSession({
        localId: 'existing-1',
        taskType: 'Bug修复',
        consumeQuota: true,
        isCompleted: true,
        isSatisfied: true,
        evaluation: 'old-eval',
      }),
      createEditableSession({
        localId: 'existing-2',
        taskType: '代码测试',
        consumeQuota: false,
        isCompleted: false,
        isSatisfied: false,
      }),
    ], 'Feature迭代');

    expect(drafts).toEqual([
      expect.objectContaining({
        localId: 'existing-1',
        sessionId: 'sess-1',
        taskType: 'Bug修复',
        consumeQuota: true,
        isCompleted: true,
        isSatisfied: true,
        evaluation: 'old-eval',
        userConversation: 'conv-1',
      }),
      expect.objectContaining({
        localId: 'existing-2',
        sessionId: 'sess-2',
        taskType: '代码测试',
        consumeQuota: false,
        isCompleted: false,
        isSatisfied: false,
        userConversation: 'conv-2',
      }),
    ]);
  });

  it('formats and parses helper display values', () => {
    expect(maskSessionId('')).toBe('未填写');
    expect(maskSessionId('1234567890')).toBe('1234567890');
    expect(maskSessionId('1234567890123')).toBe('1234...0123');

    expect(formatBooleanSelection(true)).toBe('true');
    expect(formatBooleanSelection(false)).toBe('false');
    expect(formatBooleanSelection(null)).toBe('');

    expect(parseBooleanSelection('true')).toBe(true);
    expect(parseBooleanSelection('false')).toBe(false);
    expect(parseBooleanSelection('')).toBeNull();
  });

  it('builds decision badges for true, false, and unset values', () => {
    expect(getSessionDecisionBadge(true, '已完成', '未完成')).toEqual(expect.objectContaining({
      label: '已完成',
      className: expect.stringContaining('emerald'),
    }));
    expect(getSessionDecisionBadge(false, '已完成', '未完成')).toEqual(expect.objectContaining({
      label: '未完成',
      className: expect.stringContaining('rose'),
    }));
    expect(getSessionDecisionBadge(null, '已完成', '未完成')).toBeNull();
  });
});
