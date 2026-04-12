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
  gitInitializedCount: number;
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
  gitInitializedCount: number;
  details: NormalizeManagedSourceFolderDetail[];
}

export interface DirectoryInspectionResult {
  path: string;
  name: string;
  exists: boolean;
  isDir: boolean;
  isEmpty: boolean;
}

export interface ManagedClaimPathPlan {
  sequence: number;
  taskPath: string;
  sourcePath: string;
}

export async function fetchGitLabProject(projectRef: string, url: string, token: string): Promise<GitLabProject> {
  return callService('GitService', 'FetchGitLabProject', projectRef, url, token);
}

export async function fetchGitLabProjects(
  projectRefs: string[],
  url: string,
  token: string,
): Promise<GitLabProjectLookupResult[]> {
  return callService('GitService', 'FetchGitLabProjects', projectRefs, url, token);
}

export async function fetchConfiguredGitLabProjects(
  projectRefs: string[],
): Promise<GitLabProjectLookupResult[]> {
  return callService('GitService', 'FetchConfiguredGitLabProjects', projectRefs);
}

export async function cloneProject(cloneUrl: string, path: string, username: string, token: string): Promise<void> {
  return callService('GitService', 'CloneProject', cloneUrl, path, username, token);
}

export async function cloneConfiguredProject(cloneUrl: string, path: string): Promise<void> {
  return callService('GitService', 'CloneConfiguredProject', cloneUrl, path);
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
  return callService('GitService', 'CheckPathsExist', paths);
}

export async function inspectDirectory(path: string): Promise<DirectoryInspectionResult> {
  return callService('GitService', 'InspectDirectory', path);
}

export async function planManagedClaimPaths(
  basePath: string,
  projectName: string,
  projectId: number,
  taskType: string,
  count: number,
  projectConfigId: string,
): Promise<ManagedClaimPathPlan[]> {
  return callService(
    'GitService',
    'PlanManagedClaimPaths',
    basePath,
    projectName,
    projectId,
    taskType,
    count,
    projectConfigId,
  );
}

export async function normalizeManagedSourceFolders(projectId: string): Promise<NormalizeManagedSourceFoldersResult> {
  return callService('GitService', 'NormalizeManagedSourceFolders', projectId);
}

export function onCloneProgress(callback: (message: string) => void): () => void {
  const cancel = Events.On('clone-progress', (event: { data: string }) => callback(event.data));
  return cancel;
}
