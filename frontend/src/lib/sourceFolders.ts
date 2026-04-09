const DEFAULT_MANAGED_SOURCE_FOLDER_NAME = 'source';
const DEFAULT_MANAGED_TASK_TYPE_NAME = 'feature迭代';

function normalizeManagedFolderToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\\/]/g, '-').replace(/\s+/g, '');
}

export function normalizeManagedProjectFolderName(projectName: string): string {
  return normalizeManagedFolderToken(projectName) || DEFAULT_MANAGED_SOURCE_FOLDER_NAME;
}

export function normalizeManagedTaskTypeFolderName(taskType: string): string {
  return (normalizeManagedFolderToken(taskType) || DEFAULT_MANAGED_TASK_TYPE_NAME).toLowerCase();
}

export function buildManagedTaskFolderName(projectName: string, taskType: string): string {
  return `${normalizeManagedProjectFolderName(projectName)}-${normalizeManagedTaskTypeFolderName(taskType)}`;
}

export function buildManagedTaskFolderPath(basePath: string, projectName: string, taskType: string): string {
  const trimmedBase = basePath.trim().replace(/[\\/]+$/, '');
  const folderName = buildManagedTaskFolderName(projectName, taskType);
  return trimmedBase ? `${trimmedBase}/${folderName}` : folderName;
}

export function buildManagedSourceFolderName(projectId: number | string, taskType: string): string {
  const rawId = String(projectId).trim().replace(/^label-/i, '');
  const normalizedId = /^\d+$/.test(rawId) ? rawId.padStart(5, '0') : rawId;
  return `${normalizedId}-${normalizeManagedTaskTypeFolderName(taskType)}`;
}

export function buildManagedSourceFolderPath(basePath: string, projectId: number | string, taskType: string): string {
  const trimmedBase = basePath.trim().replace(/[\\/]+$/, '');
  const folderName = buildManagedSourceFolderName(projectId, taskType);
  return trimmedBase ? `${trimmedBase}/${folderName}` : folderName;
}

export function getPathBase(path: string | null | undefined): string {
  if (!path) return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
