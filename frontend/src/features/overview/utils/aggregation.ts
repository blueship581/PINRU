import type { TaskFromDB } from '../../../api/task';
import { normalizeTaskTypeName } from '../../../shared/lib/taskTypes';

export interface RepoDistributionRow {
  repoId: string;
  repoName: string;
  taskCounts: Record<string, number>;
  total: number;
}

export interface RepoPromptEntry {
  taskId: string;
  taskLabel: string;
  taskType: string;
  promptText: string;
  status: string;
  createdAt: number;
}

export interface RepoPromptGroup {
  repoId: string;
  repoName: string;
  entries: RepoPromptEntry[];
}

export interface OverviewAggregates {
  rows: RepoDistributionRow[];
  taskTypes: string[];
  promptGroups: RepoPromptGroup[];
  totals: {
    repos: number;
    tasks: number;
    taskTypes: number;
    promptsFilled: number;
    promptsEmpty: number;
  };
}

function normalizeType(value: string | null | undefined) {
  const normalized = normalizeTaskTypeName(value ?? '');
  return normalized || '未归类';
}

export function buildOverviewAggregates(tasks: TaskFromDB[] | null | undefined): OverviewAggregates {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const groups = new Map<
    string,
    {
      repoId: string;
      repoName: string;
      latestCreatedAt: number;
      taskCounts: Record<string, number>;
      total: number;
      entries: RepoPromptEntry[];
    }
  >();

  const taskTypeTotals = new Map<string, number>();
  let promptsFilled = 0;
  let promptsEmpty = 0;

  for (const task of safeTasks) {
    if (!task) continue;
    const repoId = task.gitlabProjectId != null ? String(task.gitlabProjectId).trim() : '';
    if (!repoId) continue;

    const taskType = normalizeType(task.taskType);
    const createdAt = Number.isFinite(task.createdAt) ? task.createdAt : 0;
    const promptText = (task.promptText ?? '').trim();

    if (promptText) promptsFilled += 1;
    else promptsEmpty += 1;

    taskTypeTotals.set(taskType, (taskTypeTotals.get(taskType) ?? 0) + 1);

    const group = groups.get(repoId);
    const entry: RepoPromptEntry = {
      taskId: task.id,
      taskLabel: '',
      taskType,
      promptText,
      status: task.status,
      createdAt,
    };

    if (group) {
      group.taskCounts[taskType] = (group.taskCounts[taskType] ?? 0) + 1;
      group.total += 1;
      group.entries.push(entry);
      if (createdAt > group.latestCreatedAt) {
        group.latestCreatedAt = createdAt;
        if (task.projectName) group.repoName = task.projectName;
      }
    } else {
      groups.set(repoId, {
        repoId,
        repoName: task.projectName || repoId,
        latestCreatedAt: createdAt,
        taskCounts: { [taskType]: 1 },
        total: 1,
        entries: [entry],
      });
    }
  }

  const rows: RepoDistributionRow[] = Array.from(groups.values())
    .map(({ repoId, repoName, taskCounts, total }) => ({ repoId, repoName, taskCounts, total }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.repoName.localeCompare(b.repoName);
    });

  const taskTypes: string[] = Array.from(taskTypeTotals.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
    .map(([taskType]) => taskType);

  const promptGroups: RepoPromptGroup[] = Array.from(groups.values())
    .map(({ repoId, repoName, entries }) => {
      const ordered = entries.slice().sort((a, b) => a.createdAt - b.createdAt);
      const labelBase = repoName || repoId;
      const labelled = ordered.map((entry, idx) => ({
        ...entry,
        taskLabel: `${labelBase}-${idx + 1}`,
      }));
      return {
        repoId,
        repoName,
        entries: labelled.slice().sort((a, b) => b.createdAt - a.createdAt),
      };
    })
    .sort((a, b) => {
      if (b.entries.length !== a.entries.length) return b.entries.length - a.entries.length;
      return a.repoName.localeCompare(b.repoName);
    });

  return {
    rows,
    taskTypes,
    promptGroups,
    totals: {
      repos: rows.length,
      tasks: safeTasks.length,
      taskTypes: taskTypes.length,
      promptsFilled,
      promptsEmpty,
    },
  };
}
