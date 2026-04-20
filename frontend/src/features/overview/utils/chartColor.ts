import { normalizeTaskTypeName, DEFAULT_TASK_TYPE } from '../../../shared/lib/taskTypes';

const TASK_TYPE_HEX_PALETTE = [
  '#8b5cf6',
  '#f43f5e',
  '#f59e0b',
  '#0ea5e9',
  '#10b981',
  '#d946ef',
  '#06b6d4',
  '#f97316',
] as const;

function hashTaskType(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getTaskTypeChartColor(taskType: string): string {
  const normalized = normalizeTaskTypeName(taskType) || DEFAULT_TASK_TYPE;
  const identity = normalized.toLowerCase();
  return TASK_TYPE_HEX_PALETTE[hashTaskType(identity) % TASK_TYPE_HEX_PALETTE.length];
}
