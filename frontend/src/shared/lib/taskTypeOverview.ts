import type { Task, TaskStatus } from '../../store';
import { getTaskTypeQuotaValue, normalizeTaskTypeName, type TaskTypeQuotas } from './taskTypes';
import { countCountedSessionsByTaskType } from './sessionUtils';

export type TaskTypeOverviewSummary = {
  taskType: string;
  remainingQuota: number | null;
  waitingTasks: Task[];
  processingTasks: Task[];
  submittedTasks: Task[];
  errorTasks: Task[];
  submittedSessionCount: number;
  allocatedSessionCount: number;
  totalTaskCount: number;
};

const PROCESSING_STATUSES: TaskStatus[] = ['Downloading', 'Downloaded', 'PromptReady'];

export function buildTaskTypeOverviewSummaries(
  availableTaskTypes: string[],
  tasks: Task[],
  projectQuotas: TaskTypeQuotas,
  projectTotals: TaskTypeQuotas,
): TaskTypeOverviewSummary[] {
  const countedSessionsByTaskType = countCountedSessionsByTaskType(tasks);
  const submittedSessionsByTaskType = countCountedSessionsByTaskType(tasks, {
    status: 'Submitted',
    requireSessionId: true,
  });

  return availableTaskTypes.map((taskType) => {
    const matchingTasks = tasks.filter(
      (task) => normalizeTaskTypeName(task.taskType) === taskType,
    );
    const remainingQuota = getTaskTypeQuotaValue(projectQuotas, taskType);
    const fixedTotal = getTaskTypeQuotaValue(projectTotals, taskType);
    const waitingTasks = matchingTasks.filter((task) => task.status === 'Claimed');
    const processingTasks = matchingTasks.filter((task) =>
      PROCESSING_STATUSES.includes(task.status),
    );
    const submittedTasks = matchingTasks.filter((task) => task.status === 'Submitted');
    const errorTasks = matchingTasks.filter((task) => task.status === 'Error');

    return {
      taskType,
      remainingQuota,
      waitingTasks,
      processingTasks,
      submittedTasks,
      errorTasks,
      submittedSessionCount: submittedSessionsByTaskType[taskType] ?? 0,
      allocatedSessionCount: countedSessionsByTaskType[taskType] ?? 0,
      totalTaskCount:
        fixedTotal ??
        (remainingQuota === null ? matchingTasks.length : matchingTasks.length + remainingQuota),
    };
  });
}
