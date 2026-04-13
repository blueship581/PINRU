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

function appendManagedFolderSequence(folderName: string, sequence: number): string {
  return sequence > 0 ? `${folderName}-${sequence}` : folderName;
}

export function parseManagedFolderSequence(name: string, baseName: string): number | null {
  const trimmedName = name.trim();
  const trimmedBase = baseName.trim();
  if (!trimmedName || !trimmedBase) return null;
  if (trimmedName === trimmedBase) return 0;
  if (!trimmedName.startsWith(`${trimmedBase}-`)) return null;

  const sequence = Number.parseInt(trimmedName.slice(trimmedBase.length + 1), 10);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

export function buildManagedTaskFolderNameWithSequence(
  projectName: string,
  taskType: string,
  sequence: number,
): string {
  return appendManagedFolderSequence(buildManagedTaskFolderName(projectName, taskType), sequence);
}

export function buildManagedTaskFolderPath(basePath: string, projectName: string, taskType: string): string {
  return buildManagedTaskFolderPathWithSequence(basePath, projectName, taskType, 0);
}

export function buildManagedTaskFolderPathWithSequence(
  basePath: string,
  projectName: string,
  taskType: string,
  sequence: number,
): string {
  const trimmedBase = basePath.trim().replace(/[\\/]+$/, '');
  const folderName = buildManagedTaskFolderNameWithSequence(projectName, taskType, sequence);
  return trimmedBase ? `${trimmedBase}/${folderName}` : folderName;
}

export function buildManagedSourceFolderName(projectId: number | string, taskType: string): string {
  const rawId = String(projectId).trim().replace(/^label-/i, '');
  const normalizedId = /^\d+$/.test(rawId) ? rawId.padStart(5, '0') : rawId;
  return `${normalizedId}-${normalizeManagedTaskTypeFolderName(taskType)}`;
}

export function buildManagedSourceFolderNameWithSequence(
  projectId: number | string,
  taskType: string,
  sequence: number,
): string {
  return appendManagedFolderSequence(buildManagedSourceFolderName(projectId, taskType), sequence);
}

export function buildManagedSourceFolderPath(basePath: string, projectId: number | string, taskType: string): string {
  return buildManagedSourceFolderPathWithSequence(basePath, projectId, taskType, 0);
}

export function buildManagedSourceFolderPathWithSequence(
  basePath: string,
  projectId: number | string,
  taskType: string,
  sequence: number,
): string {
  const trimmedBase = basePath.trim().replace(/[\\/]+$/, '');
  const folderName = buildManagedSourceFolderNameWithSequence(projectId, taskType, sequence);
  return trimmedBase ? `${trimmedBase}/${folderName}` : folderName;
}

export function parseManagedTaskFolderSequence(
  name: string,
  projectName: string,
  taskType: string,
): number | null {
  return parseManagedFolderSequence(name, buildManagedTaskFolderName(projectName, taskType));
}

export function parseManagedSourceFolderSequence(
  name: string,
  projectId: number | string,
  taskType: string,
): number | null {
  return parseManagedFolderSequence(name, buildManagedSourceFolderName(projectId, taskType));
}

export function getPathBase(path: string | null | undefined): string {
  if (!path) return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
