const DEFAULT_MANAGED_SOURCE_FOLDER_NAME = 'source';

export function normalizeManagedSourceFolderName(projectName: string): string {
  const trimmed = projectName.trim();
  if (!trimmed) return DEFAULT_MANAGED_SOURCE_FOLDER_NAME;
  return trimmed.replace(/[\\/]/g, '-');
}

export function buildManagedSourceFolderPath(basePath: string, projectName: string): string {
  const trimmedBase = basePath.trim().replace(/[\\/]+$/, '');
  const folderName = normalizeManagedSourceFolderName(projectName);
  return trimmedBase ? `${trimmedBase}/${folderName}` : folderName;
}

export function getPathBase(path: string | null | undefined): string {
  if (!path) return '';
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}
