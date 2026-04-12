import {
  buildManagedSourceFolderPathWithSequence,
  buildManagedTaskFolderPathWithSequence,
} from '../../../shared/lib/sourceFolders';
import type { ClaimResult, ModelEntry } from '../types';

export function formatProjectName(value: string) {
  return `label-${value.padStart(5, '0')}`;
}

export function buildProjectRef(value: string) {
  return `prompt2repo/${formatProjectName(value)}`;
}

export function buildProjectBasePath(
  projectName: string,
  taskType: string,
  root: string,
  sequence = 0,
) {
  return buildManagedTaskFolderPathWithSequence(root, projectName, taskType, sequence);
}

export function buildProjectSourcePath(
  projectNumber: string,
  taskType: string,
  basePath: string,
  sequence = 0,
) {
  return buildManagedSourceFolderPathWithSequence(basePath, projectNumber, taskType, sequence);
}

export function formatClaimProjectId(projectId: string, sequence: number) {
  return sequence > 0 ? `${projectId}-${sequence}` : projectId;
}

export function parseProjectIds(value: string): string[] {
  const tokens = value
    .split(/[\s,，、;；]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const token of tokens) {
    if (!/^\d+$/.test(token) || seen.has(token)) continue;
    seen.add(token);
    ids.push(token);
  }
  return ids;
}

export function isOriginModel(value: string): boolean {
  return value.trim().toUpperCase() === 'ORIGIN';
}

export function pickSourceModel(
  models: ModelEntry[],
  preferredSourceModelName: string,
): ModelEntry {
  return (
    models.find(
      (model) =>
        model.id.trim().toUpperCase() === preferredSourceModelName.trim().toUpperCase(),
    ) ??
    models.find((model) => isOriginModel(model.id)) ??
    models[0]
  );
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return String(error);
}

export function getModelStatusLabel(status: ModelEntry['status']): string {
  switch (status) {
    case 'done':
      return '✓ 完成';
    case 'cloning':
      return 'git clone 中…';
    case 'copying':
      return '复制并初始化 Git…';
    case 'error':
      return '✗ 失败';
    default:
      return '等待';
  }
}

export function getModelStatusClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'done':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'cloning':
    case 'copying':
      return 'text-slate-700 dark:text-slate-300';
    case 'error':
      return 'text-red-500';
    default:
      return 'text-stone-400';
  }
}

export function getModelStatusBarClassName(status: ModelEntry['status']): string {
  switch (status) {
    case 'cloning':
    case 'copying':
      return 'w-full bg-slate-500 animate-pulse';
    case 'done':
      return 'w-full bg-emerald-500';
    case 'error':
      return 'w-full bg-red-400';
    default:
      return 'w-0';
  }
}

export function getResultStatusMeta(status: ClaimResult['status']): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'running':
      return {
        label: '处理中',
        className: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
      };
    case 'done':
      return {
        label: '完成',
        className:
          'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      };
    case 'partial':
      return {
        label: '部分完成',
        className: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400',
      };
    case 'error':
      return {
        label: '失败',
        className: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
      };
    default:
      return {
        label: '等待中',
        className:
          'bg-stone-100 dark:bg-stone-800/60 text-stone-500 dark:text-stone-400',
      };
  }
}
