import { callService } from './wails';
import { Events } from '@wailsio/runtime';

export interface GitLabProject {
  id: number;
  name: string;
  description: string | null;
  web_url: string;
  default_branch: string | null;
  http_url_to_repo: string | null;
}

export interface GitLabProjectLookupResult {
  projectRef: string;
  project: GitLabProject | null;
  error: string | null;
}

export interface NormalizeManagedSourceFolderDetail {
  taskId: string;
  projectName: string;
  sourceModelName: string;
  previousPath: string;
  currentPath: string;
  status: string;
  message: string;
}

export interface NormalizeManagedSourceFoldersResult {
  projectId: string;
  projectName: string;
  totalTasks: number;
  renamedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  details: NormalizeManagedSourceFolderDetail[];
}

export async function fetchGitLabProject(projectRef: string, url: string, token: string): Promise<GitLabProject> {
  return callService<GitLabProject>('GitService', 'FetchGitLabProject', projectRef, url, token);
}

export async function fetchGitLabProjects(
  projectRefs: string[],
  url: string,
  token: string,
): Promise<GitLabProjectLookupResult[]> {
  return callService<GitLabProjectLookupResult[]>('GitService', 'FetchGitLabProjects', projectRefs, url, token);
}

export async function cloneProject(cloneUrl: string, path: string, username: string, token: string): Promise<void> {
  return callService('GitService', 'CloneProject', cloneUrl, path, username, token);
}

export async function downloadGitLabProject(
  projectId: number,
  url: string,
  token: string,
  destination: string,
  sha?: string | null,
): Promise<void> {
  return callService('GitService', 'DownloadGitLabProject', projectId, url, token, destination, sha ?? null);
}

export async function copyProjectDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  return callService('GitService', 'CopyProjectDirectory', sourcePath, destinationPath);
}

export async function checkPathsExist(paths: string[]): Promise<string[]> {
  return callService<string[]>('GitService', 'CheckPathsExist', paths);
}

export async function normalizeManagedSourceFolders(projectId: string): Promise<NormalizeManagedSourceFoldersResult> {
  return callService<NormalizeManagedSourceFoldersResult>('GitService', 'NormalizeManagedSourceFolders', projectId);
}

export function onCloneProgress(callback: (message: string) => void): () => void {
  const cancel = Events.On('clone-progress', (event: { data: string }) => callback(event.data));
  return cancel;
}
