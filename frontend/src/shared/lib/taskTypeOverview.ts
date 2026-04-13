import type { Task, TaskStatus } from '../../store';
import { getTaskTypeQuotaValue, normalizeTaskTypeName, type TaskTypeQuotas } from './taskTypes';
import { countCountedSessionsByTaskType } from './sessionUtils';

export type TaskTypeOverviewSummary = {
  taskType: string;
  remainingQuota: number | null;
  remainingToCompleteCount: number | null;
  waitingTasks: Task[];
  processingTasks: Task[];
  submittedTasks: Task[];
  errorTasks: Task[];
  submittedSessionCount: number;
  allocatedSessionCount: number;
  totalTaskCount: number;
};

const PROCESSING_STATUSES: TaskStatus[] = [
  'Downloading',
  'Downloaded',
  'PromptReady',
  'ExecutionCompleted',
];

export function getTaskTypeRemainingToCompleteCount(
  taskType: string,
  projectQuotas: TaskTypeQuotas,
  projectTotals: TaskTypeQuotas,
  submittedSessionCount: number,
) {
  const fixedTotal = getTaskTypeQuotaValue(projectTotals, taskType);
  if (fixedTotal !== null) {
    return Math.max(0, fixedTotal - submittedSessionCount);
  }

  const quotaValue = getTaskTypeQuotaValue(projectQuotas, taskType);
  if (quotaValue !== null) {
    return Math.max(0, quotaValue - submittedSessionCount);
  }
  return null;
}

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
    const submittedSessionCount = submittedSessionsByTaskType[taskType] ?? 0;

    return {
      taskType,
      remainingQuota,
      remainingToCompleteCount: getTaskTypeRemainingToCompleteCount(
        taskType,
        projectQuotas,
        projectTotals,
        submittedSessionCount,
      ),
      waitingTasks,
      processingTasks,
      submittedTasks,
      errorTasks,
      submittedSessionCount,
      allocatedSessionCount: countedSessionsByTaskType[taskType] ?? 0,
      totalTaskCount:
        fixedTotal ??
        (remainingQuota === null ? matchingTasks.length : matchingTasks.length + remainingQuota),
    };
  });
}
