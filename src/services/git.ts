import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export async function fetchGitLabProject(projectRef: string, url: string, token: string): Promise<GitLabProject> {
  return invoke<GitLabProject>('fetch_gitlab_project', { projectRef, url, token });
}

export async function fetchGitLabProjects(
  projectRefs: string[],
  url: string,
  token: string,
): Promise<GitLabProjectLookupResult[]> {
  return invoke<GitLabProjectLookupResult[]>('fetch_gitlab_projects', { projectRefs, url, token });
}

export async function cloneProject(cloneUrl: string, path: string, username: string, token: string): Promise<void> {
  return invoke('clone_project', { cloneUrl, path, username, token });
}

export async function downloadGitLabProject(
  projectId: number,
  url: string,
  token: string,
  destination: string,
  sha?: string | null,
): Promise<void> {
  return invoke('download_gitlab_project', { projectId, url, token, destination, sha });
}

export async function copyProjectDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  return invoke('copy_project_directory', { sourcePath, destinationPath });
}

export async function checkPathsExist(paths: string[]): Promise<string[]> {
  return invoke<string[]>('check_paths_exist', { paths });
}

export function onCloneProgress(callback: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>('clone-progress', (event) => callback(event.payload));
}
