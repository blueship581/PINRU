import type { TaskFromDB, AiReviewRoundFromDB, ModelRunFromDB, TaskSession } from '../../api/task';
import type { ReportRow } from './types';

function getLatestAiRound(rounds: AiReviewRoundFromDB[]): AiReviewRoundFromDB | null {
  if (rounds.length === 0) return null;
  return rounds.reduce((latest, r) =>
    r.roundNumber > latest.roundNumber ? r : latest,
  );
}

/**
 * Collect all available session data from model runs (excluding ORIGIN/source).
 *
 * Session ID sources (priority order):
 * 1. TaskSession.sessionId inside ModelRun.sessionList (extracted from Trae logs)
 * 2. ModelRun.sessionId (model-run-level, from UpdateModelRunSessionInfo)
 * 3. TaskSession.sessionId inside Task.sessionList (task-level fallback)
 */
function collectExecutionData(modelRuns: ModelRunFromDB[]): {
  sessions: TaskSession[];
  modelRunSessionId: string;
  modelRunId: string;
} {
  const sessions: TaskSession[] = [];
  let modelRunSessionId = '';
  let modelRunId = '';

  for (const run of modelRuns) {
    if (run.modelName.trim().toUpperCase() === 'ORIGIN') continue;

    // Capture the first non-ORIGIN model run ID and its sessionId
    if (!modelRunId) {
      modelRunId = run.id;
    }
    if (!modelRunSessionId && run.sessionId && run.sessionId.trim()) {
      modelRunSessionId = run.sessionId.trim();
    }

    const runSessions = run.sessionList ?? [];
    for (const s of runSessions) {
      if (s.consumeQuota) {
        sessions.push(s);
      }
    }
  }

  // If we got sessions but still no modelRunSessionId, try from the first session
  if (!modelRunSessionId && sessions.length > 0 && sessions[0].sessionId) {
    modelRunSessionId = sessions[0].sessionId;
  }

  return { sessions, modelRunSessionId, modelRunId };
}

export function assembleReportRows(
  tasks: TaskFromDB[],
  modelRunsByTask: Map<string, ModelRunFromDB[]>,
  aiRoundsByTask: Map<string, AiReviewRoundFromDB[]>,
): ReportRow[] {
  const rows: ReportRow[] = [];

  for (const task of tasks) {
    const rounds = aiRoundsByTask.get(task.id) ?? [];
    const latestRound = getLatestAiRound(rounds);
    const aiProjectType = latestRound?.projectType ?? '';
    const aiChangeScope = latestRound?.changeScope ?? '';

    const modelRuns = modelRunsByTask.get(task.id) ?? [];
    const { sessions: mrSessions, modelRunSessionId } = collectExecutionData(modelRuns);

    // Prefer model run sessions (consumeQuota=true); fall back to task.sessionList
    const sessions = mrSessions.length > 0
      ? mrSessions
      : (task.sessionList ?? []).filter((s) => s.consumeQuota);

    // Resolve the best available sessionId for this task:
    // ModelRun.sessionId > first session's sessionId > task.sessionList[0].sessionId
    const fallbackSessionId =
      modelRunSessionId ||
      (sessions.length > 0 ? sessions[0].sessionId : '') ||
      ((task.sessionList ?? []).length > 0 ? (task.sessionList ?? [])[0].sessionId : '');

    if (sessions.length === 0) {
      rows.push({
        taskId: task.id,
        repoId: task.gitlabProjectId,
        sessionId: fallbackSessionId,
        sessionIndex: -1,
        promptText: task.promptText,
        taskType: task.taskType,
        projectType: task.projectType || aiProjectType,
        changeScope: task.changeScope || aiChangeScope,
        isCompleted: null,
        isSatisfied: null,
        dissatisfactionReason: '',
        aiProjectType,
        aiChangeScope,
      });
    } else {
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        rows.push({
          taskId: task.id,
          repoId: task.gitlabProjectId,
          sessionId: session.sessionId || fallbackSessionId,
          sessionIndex: i,
          promptText: task.promptText,
          taskType: task.taskType,
          projectType: task.projectType || aiProjectType,
          changeScope: task.changeScope || aiChangeScope,
          isCompleted: session.isCompleted ?? null,
          isSatisfied: session.isSatisfied ?? null,
          dissatisfactionReason: session.evaluation ?? '',
          aiProjectType,
          aiChangeScope,
        });
      }
    }
  }

  // Sort by repoId ascending (numeric)
  rows.sort((a, b) => a.repoId - b.repoId);

  return rows;
}
