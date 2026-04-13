import { describe, expect, it } from 'vitest';
import {
  buildSessionModelOptions,
  filterCandidatesForModel,
  matchKindLabel,
  pathMatchesModelPath,
  resolveCandidateModelName,
} from '../sessionCandidateUtils';
import type { ExtractTaskSessionCandidate, ModelRunFromDB } from '../../../api/task';

function buildModelRun(overrides: Partial<ModelRunFromDB>): ModelRunFromDB {
  return {
    id: overrides.id ?? 'run-1',
    taskId: overrides.taskId ?? 'task-1',
    modelName: overrides.modelName ?? 'model-a',
    branchName: overrides.branchName ?? null,
    localPath: overrides.localPath ?? null,
    prUrl: overrides.prUrl ?? null,
    originUrl: overrides.originUrl ?? null,
    gsbScore: overrides.gsbScore ?? null,
    status: overrides.status ?? 'pending',
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    sessionId: overrides.sessionId ?? null,
    conversationRounds: overrides.conversationRounds ?? 0,
    conversationDate: overrides.conversationDate ?? null,
    submitError: overrides.submitError ?? null,
    sessionList: overrides.sessionList ?? [],
    reviewStatus: overrides.reviewStatus ?? 'none',
    reviewRound: overrides.reviewRound ?? 0,
    reviewNotes: overrides.reviewNotes ?? null,
  };
}

function buildCandidate(
  overrides: Partial<ExtractTaskSessionCandidate>,
): ExtractTaskSessionCandidate {
  return {
    id: overrides.id ?? 'candidate-1',
    workspacePath: overrides.workspacePath ?? '/tmp/workspace/label-01849/model-a',
    matchedPath: overrides.matchedPath ?? '/tmp/workspace/label-01849/model-a',
    matchKind: overrides.matchKind ?? 'exact',
    sessionCount: overrides.sessionCount ?? 1,
    userId: overrides.userId ?? 'user-1',
    username: overrides.username ?? 'alice',
    currentSessionId: overrides.currentSessionId ?? 'session-current',
    userMessageCount: overrides.userMessageCount ?? 3,
    summary: overrides.summary ?? 'summary',
    lastActivityAt: overrides.lastActivityAt ?? 1712550000,
    sessions: overrides.sessions ?? [],
  };
}

describe('sessionCandidateUtils', () => {
  it('matches paths across case, separators and parent-child relations', () => {
    expect(
      pathMatchesModelPath(
        '\\work\\Label-01849\\Model-A\\',
        '/work/label-01849/model-a',
      ),
    ).toBe(true);
    expect(
      pathMatchesModelPath(
        '/workspace/label-01849/model-a/subdir',
        '/workspace/label-01849/model-a',
      ),
    ).toBe(true);
    expect(
      pathMatchesModelPath(
        '/workspace/label-01849/model-a',
        '/workspace/label-01849/model-a/subdir',
      ),
    ).toBe(true);
  });

  it('matches sibling model folders for the same task label', () => {
    expect(
      pathMatchesModelPath(
        '/workspace/label-01849/model-a',
        '/workspace/label-01849-bug修复/model-a',
      ),
    ).toBe(true);
    expect(
      pathMatchesModelPath(
        '/workspace/label-01849/model-a',
        '/workspace/label-01850-bug修复/model-a',
      ),
    ).toBe(false);
  });

  it('matches the same task across different user roots', () => {
    expect(
      pathMatchesModelPath(
        '/Users/alice/workspaces/review/label-01849-comparison/model-a',
        '/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-bug修复/model-a',
      ),
    ).toBe(true);
    expect(
      pathMatchesModelPath(
        '/Users/alice/workspaces/review/label-01849-bug修复',
        '/Users/gaobo/repositories/gitlab/review/project/generate/label-01849-comparison/model-a',
      ),
    ).toBe(true);
  });

  it('builds session model options from execution runs before falling back to source runs', () => {
    const runs = [
      buildModelRun({ modelName: 'ORIGIN', localPath: '/repo/origin' }),
      buildModelRun({ id: 'run-2', modelName: 'SOURCE', localPath: '/repo/source' }),
      buildModelRun({ id: 'run-3', modelName: 'model-a', localPath: '/repo/model-a' }),
    ];

    expect(buildSessionModelOptions(runs, 'SOURCE')).toEqual([
      { modelName: 'model-a', localPath: '/repo/model-a' },
    ]);

    expect(
      buildSessionModelOptions(
        [
          buildModelRun({ modelName: 'ORIGIN', localPath: '/repo/origin' }),
          buildModelRun({ id: 'run-4', modelName: 'SOURCE', localPath: '/repo/source' }),
        ],
        'SOURCE',
      ),
    ).toEqual([
      { modelName: 'ORIGIN', localPath: '/repo/origin' },
      { modelName: 'SOURCE', localPath: '/repo/source' },
    ]);
  });

  it('filters and resolves candidates against model runs', () => {
    const candidates = [
      buildCandidate({
        id: 'candidate-a',
        matchedPath: '/workspace/label-01849/model-a',
        workspacePath: '/workspace/label-01849/model-a',
      }),
      buildCandidate({
        id: 'candidate-b',
        matchedPath: '/workspace/label-01849/model-b',
        workspacePath: '/workspace/label-01849/model-b',
      }),
    ];
    const modelRuns = [
      buildModelRun({ modelName: 'model-a', localPath: '/workspace/label-01849-bug修复/model-a' }),
      buildModelRun({ id: 'run-b', modelName: 'model-b', localPath: '/workspace/label-01849-bug修复/model-b' }),
    ];

    expect(filterCandidatesForModel(candidates, modelRuns, 'model-a')).toEqual([candidates[0]]);
    expect(resolveCandidateModelName(candidates[1], modelRuns)).toBe('model-b');
  });

  it('maps known match kinds to stable labels', () => {
    expect(matchKindLabel('exact')).toBe('完全匹配');
    expect(matchKindLabel('sibling')).toBe('同项目模型目录');
    expect(matchKindLabel('peer_model')).toBe('同项目跨目录模型');
    expect(matchKindLabel('peer_task')).toBe('同项目跨目录');
    expect(matchKindLabel('')).toBe('未知');
  });
});
