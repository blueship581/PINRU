import type { ExtractTaskSessionCandidate, TaskSession } from '../../api/task';
import { DEFAULT_TASK_TYPE, normalizeTaskTypeName } from './taskTypes';

export type EditableTaskSession = TaskSession & {
  localId: string;
};

export function getSessionDecisionValue(
  value: boolean | null | undefined,
  fallback = true,
): boolean {
  return value ?? fallback;
}

export function createSessionDraft(
  fallbackTaskType: string,
  session?: Partial<TaskSession>,
): EditableTaskSession {
  const normalizedTaskType =
    normalizeTaskTypeName(session?.taskType ?? '') ||
    normalizeTaskTypeName(fallbackTaskType) ||
    DEFAULT_TASK_TYPE;

  return {
    localId: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId: session?.sessionId ?? '',
    taskType: normalizedTaskType,
    consumeQuota: session?.consumeQuota ?? false,
    isCompleted: getSessionDecisionValue(session?.isCompleted),
    isSatisfied: getSessionDecisionValue(session?.isSatisfied),
    evaluation: session?.evaluation ?? '',
    userConversation: session?.userConversation ?? '',
  };
}

export function hydrateSessionDrafts(
  sessionList: TaskSession[] | null | undefined,
  fallbackTaskType: string,
): EditableTaskSession[] {
  const source =
    sessionList && sessionList.length > 0
      ? sessionList
      : [{
          sessionId: '',
          taskType: fallbackTaskType,
          consumeQuota: true,
          isCompleted: true,
          isSatisfied: true,
          evaluation: '',
          userConversation: '',
        }];

  return source.map((session, index) =>
    createSessionDraft(fallbackTaskType, {
      ...session,
      consumeQuota: index === 0 || session.consumeQuota,
    }),
  );
}

export function buildSessionEditorOpenSet(sessions: EditableTaskSession[]): Set<string> {
  return new Set(
    sessions
      .filter((session) => !session.sessionId.trim())
      .map((session) => session.localId),
  );
}

export function hasSessionId(session: Pick<TaskSession, 'sessionId'>): boolean {
  return session.sessionId.trim().length > 0;
}

type CountableSession = Pick<TaskSession, 'sessionId' | 'consumeQuota'>;

export function isSessionCounted<T extends CountableSession>(
  session: T,
  index: number,
): boolean {
  return index === 0 ? true : session.consumeQuota && hasSessionId(session);
}

export function hasCountedSubmittedSession(task: { sessionList: TaskSession[] }): boolean {
  return countCountedSessions(task.sessionList) > 0;
}

export function countCountedSessions<T extends CountableSession>(
  sessions: T[],
): number {
  return sessions.reduce(
    (count, session, index) => (isSessionCounted(session, index) ? count + 1 : count),
    0,
  );
}

export function hasCountedSessionForTaskType(
  task: { sessionList: TaskSession[] },
  taskType: string,
): boolean {
  const normalizedTaskType = normalizeTaskTypeName(taskType);
  if (!normalizedTaskType) {
    return false;
  }

  return task.sessionList.some((session, index) => {
    const sessionTaskType = normalizeTaskTypeName(session.taskType);
    return sessionTaskType === normalizedTaskType && isSessionCounted(session, index);
  });
}

export function countCountedSessionsByTaskType(
  tasks: Array<{ status: string; sessionList: TaskSession[] }>,
  options?: { status?: string; requireSessionId?: boolean },
): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const task of tasks) {
    if (options?.status && task.status !== options.status) {
      continue;
    }

    for (const [index, session] of task.sessionList.entries()) {
      if (!isSessionCounted(session, index)) {
        continue;
      }
      if (options?.requireSessionId && !hasSessionId(session)) {
        continue;
      }

      const normalizedTaskType = normalizeTaskTypeName(session.taskType);
      if (!normalizedTaskType) {
        continue;
      }

      counts[normalizedTaskType] = (counts[normalizedTaskType] ?? 0) + 1;
    }
  }

  return counts;
}

export function summarizeCountedRounds<T extends CountableSession>(
  sessions: T[],
): string {
  const counted = sessions
    .map((session, index) => (isSessionCounted(session, index) ? `第${index + 1}轮` : null))
    .filter((value): value is string => Boolean(value));

  if (counted.length === 0) {
    return '当前没有计数轮次';
  }

  return `计数轮次：${counted.join('、')}`;
}

export function mapSessionDraftsToSessionList(
  sessions: EditableTaskSession[],
  fallbackTaskType: string,
): TaskSession[] {
  return sessions.map((session, index) => ({
    sessionId: session.sessionId.trim(),
    taskType: normalizeTaskTypeName(session.taskType) || fallbackTaskType,
    consumeQuota: isSessionCounted(session, index),
    isCompleted: session.isCompleted,
    isSatisfied: session.isSatisfied,
    evaluation: session.evaluation?.trim() ?? '',
    userConversation: session.userConversation?.trim() ?? '',
  }));
}

export function hasSessionDraftChanges(
  drafts: EditableTaskSession[],
  persistedSessionList: TaskSession[] | null | undefined,
  fallbackTaskType: string,
): boolean {
  const current = JSON.stringify(mapSessionDraftsToSessionList(drafts, fallbackTaskType));
  const persisted = JSON.stringify(
    mapSessionDraftsToSessionList(
      hydrateSessionDrafts(persistedSessionList, fallbackTaskType),
      fallbackTaskType,
    ),
  );

  return current !== persisted;
}

export function buildDraftsFromExtractedCandidate(
  candidate: ExtractTaskSessionCandidate,
  previousSessions: EditableTaskSession[],
  fallbackTaskType: string,
): EditableTaskSession[] {
  return candidate.sessions.map((detectedSession, index) => {
    const previous = previousSessions[index];
    const fallbackDraft = createSessionDraft(fallbackTaskType, {
      taskType: previous?.taskType ?? fallbackTaskType,
      consumeQuota: index === 0 ? true : previous?.consumeQuota ?? false,
      isCompleted: getSessionDecisionValue(previous?.isCompleted),
      isSatisfied: getSessionDecisionValue(previous?.isSatisfied),
      evaluation: previous?.evaluation ?? '',
      userConversation: previous?.userConversation ?? '',
    });

    return {
      ...fallbackDraft,
      localId: previous?.localId ?? fallbackDraft.localId,
      taskType: previous?.taskType ?? fallbackDraft.taskType,
      consumeQuota: index === 0 ? true : previous?.consumeQuota ?? fallbackDraft.consumeQuota,
      isCompleted: previous?.isCompleted ?? fallbackDraft.isCompleted,
      isSatisfied: previous?.isSatisfied ?? fallbackDraft.isSatisfied,
      evaluation: previous?.evaluation ?? fallbackDraft.evaluation,
      sessionId: detectedSession.sessionId,
      userConversation: detectedSession.userConversation ?? '',
    };
  });
}

export function maskSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return '未填写';
  }
  if (trimmed.length <= 10) {
    return trimmed;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function formatBooleanSelection(value: boolean | null | undefined): string {
  if (value === true) {
    return 'true';
  }
  if (value === false) {
    return 'false';
  }
  return '';
}

export function parseBooleanSelection(value: string): boolean | null {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

export function getSessionDecisionBadge(
  value: boolean | null | undefined,
  trueLabel: string,
  falseLabel: string,
) {
  if (value === true) {
    return {
      label: trueLabel,
      className: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    };
  }
  if (value === false) {
    return {
      label: falseLabel,
      className: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400',
    };
  }
  return null;
}
