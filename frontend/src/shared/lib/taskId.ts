import type { Task } from '../../store';

type TaskIdentityLike = Pick<Task, 'id' | 'projectId' | 'taskType'> & {
  projectName?: string;
};

export const LOCAL_IMPORT_SYNTHETIC_PROJECT_ID_MIN = 8_000_000_000_000_000;

const CLAIM_SEQUENCE_PATTERN = /label-\d+(?:-(\d+))$/;

export function isLocalSyntheticProjectId(projectId: string | number): boolean {
  const normalized =
    typeof projectId === 'number' ? projectId : Number.parseInt(String(projectId).trim(), 10);
  return Number.isFinite(normalized) && normalized >= LOCAL_IMPORT_SYNTHETIC_PROJECT_ID_MIN;
}

export function extractTaskClaimSequence(taskId: string): number | null {
  const match = taskId.match(CLAIM_SEQUENCE_PATTERN);
  if (!match || !match[1]) {
    return null;
  }

  const sequence = Number.parseInt(match[1], 10);
  return Number.isFinite(sequence) && sequence > 0 ? sequence : null;
}

export function formatTaskDisplayId(task: TaskIdentityLike): string {
  const projectId = task.projectId.trim() || task.id.trim() || 'unknown';
  const projectName = task.projectName?.trim() || '';
  const taskType = task.taskType.trim() || '未归类';
  const sequence = extractTaskClaimSequence(task.id);

  if (isLocalSyntheticProjectId(projectId) && projectName) {
    return sequence ? `${projectName}-${sequence}` : projectName;
  }

  return sequence ? `${projectId}-${taskType}-${sequence}` : `${projectId}-${taskType}`;
}
