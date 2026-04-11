import { getPathBase } from '../../../shared/lib/sourceFolders';
import { normalizeTaskTypeName } from '../../../api/config';
import type { ModelRunFromDB, TaskFromDB } from '../../../api/task';
import type { TaskWorkspaceOption } from '../types';

export function getAssistantDisplayContent(rawContent: string): string {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith('{')) {
    return rawContent;
  }

  try {
    const parsed = JSON.parse(trimmed) as { prompt?: string; promptText?: string };
    const prompt =
      typeof parsed.prompt === 'string'
        ? parsed.prompt.trim()
        : typeof parsed.promptText === 'string'
          ? parsed.promptText.trim()
          : '';
    return prompt || rawContent;
  } catch {
    return rawContent;
  }
}

export function buildTaskWorkspaceOptions(
  task: TaskFromDB | null,
  modelRuns: ModelRunFromDB[],
  preferredSourceModelName: string,
): TaskWorkspaceOption[] {
  const normalizedSourceModel = preferredSourceModelName.trim().toUpperCase() || 'ORIGIN';
  const options: TaskWorkspaceOption[] = [];
  const seen = new Set<string>();

  const pushOption = (option: TaskWorkspaceOption) => {
    const key = option.id.toUpperCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    options.push(option);
  };

  modelRuns.forEach((run) => {
    const modelName = run.modelName.trim();
    const localPath = run.localPath?.trim();
    if (!modelName || !localPath) {
      return;
    }

    pushOption({
      id: `model:${modelName}`,
      label: modelName,
      path: localPath,
      isSource: modelName.toUpperCase() === normalizedSourceModel,
    });
  });

  if (!options.length) {
    const taskPath = task?.localPath?.trim();
    if (taskPath) {
      pushOption({
        id: 'task:base',
        label: '默认目录',
        path: taskPath,
        isSource: true,
      });
    }
  }

  return options.sort((left, right) => {
    if (left.isSource !== right.isSource) {
      return left.isSource ? -1 : 1;
    }
    return left.label.localeCompare(right.label, 'zh-CN', { sensitivity: 'base' });
  });
}

export function formatWorkspaceOptionLabel(option: TaskWorkspaceOption): string {
  const pathBase = getPathBase(option.path);
  const parts = [option.label];
  if (pathBase && pathBase !== option.label) {
    parts.push(pathBase);
  }
  if (option.isSource) {
    parts.push('源码');
  }
  return parts.join(' · ');
}

export function resolvePromptTaskTypeSelection(
  taskType: string | null | undefined,
  currentSelection: string,
  options: Array<{ value: string }>,
): string {
  const allowedTaskTypes = new Set(options.map((option) => option.value));
  const normalizedSelection = normalizeTaskTypeName(currentSelection) || currentSelection.trim();
  if (normalizedSelection && allowedTaskTypes.has(normalizedSelection)) {
    return normalizedSelection;
  }

  const normalizedTaskType = normalizeTaskTypeName(taskType ?? '') || String(taskType ?? '').trim();
  if (normalizedTaskType && allowedTaskTypes.has(normalizedTaskType)) {
    return normalizedTaskType;
  }

  return '';
}
