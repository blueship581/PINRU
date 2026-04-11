import type { Task, TaskStatus, TaskType } from '../../../store';
import { normalizeTaskTypeName } from '../../../shared/lib/taskTypes';

export type BoardSortOption =
  | 'created-desc'
  | 'created-asc'
  | 'round-desc'
  | 'round-asc';

export function getAvailableExecutionRounds(tasks: Task[]) {
  return Array.from(new Set(tasks.map((task) => task.executionRounds))).sort((left, right) => left - right);
}

export function filterBoardTasks(
  tasks: Task[],
  {
    search,
    activeTypes,
    activeStages,
    activeRounds,
  }: {
    search: string;
    activeTypes: Set<TaskType>;
    activeStages: Set<TaskStatus>;
    activeRounds: Set<number>;
  },
) {
  const normalizedSearch = search.trim().toLowerCase();

  return tasks.filter((task) => {
    const matchSearch =
      !normalizedSearch ||
      task.projectName.toLowerCase().includes(normalizedSearch) ||
      task.projectId.includes(search) ||
      task.id.toLowerCase().includes(normalizedSearch);
    const matchType = activeTypes.size === 0 || activeTypes.has(normalizeTaskTypeName(task.taskType));
    const matchStage = activeStages.size === 0 || activeStages.has(task.status);
    const matchRound = activeRounds.size === 0 || activeRounds.has(task.executionRounds);

    return matchSearch && matchType && matchStage && matchRound;
  });
}

export function sortBoardTasks(tasks: Task[], sortBy: BoardSortOption) {
  const next = [...tasks];
  const compareByName = (left: Task, right: Task) =>
    left.projectName.localeCompare(right.projectName, 'zh-CN', { numeric: true, sensitivity: 'base' });

  next.sort((left, right) => {
    if (sortBy === 'created-asc') {
      return left.createdAt - right.createdAt || right.executionRounds - left.executionRounds || compareByName(left, right);
    }
    if (sortBy === 'round-desc') {
      return right.executionRounds - left.executionRounds || right.createdAt - left.createdAt || compareByName(left, right);
    }
    if (sortBy === 'round-asc') {
      return left.executionRounds - right.executionRounds || right.createdAt - left.createdAt || compareByName(left, right);
    }
    return right.createdAt - left.createdAt || right.executionRounds - left.executionRounds || compareByName(left, right);
  });

  return next;
}

export function groupBoardTasks(availableTaskTypes: string[], tasks: Task[]) {
  const grouped = new Map<string, Task[]>();

  for (const taskType of availableTaskTypes) {
    grouped.set(taskType, []);
  }

  for (const task of tasks) {
    const normalizedTaskType = normalizeTaskTypeName(task.taskType) || task.taskType;
    const existingTasks = grouped.get(normalizedTaskType);
    if (existingTasks) {
      existingTasks.push(task);
      continue;
    }
    grouped.set(normalizedTaskType, [task]);
  }

  return Array.from(grouped.entries())
    .map(([taskType, groupedTasks]) => ({ taskType, tasks: groupedTasks }))
    .filter((group) => group.tasks.length > 0);
}
