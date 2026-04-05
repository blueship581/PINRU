import { invoke } from '@tauri-apps/api/core';
import type { LlmProviderConfig } from './llm';

export interface ProjectConfig {
  id: string;
  name: string;
  basePath: string;
  models: string[];
  defaultSubmitRepo?: string | null;
  sourceModelFolder?: string | null;
}

export interface GitHubAccountConfig {
  id: string;
  name: string;
  username: string;
  token: string;
  defaultRepo?: string | null;
  isDefault: boolean;
}

export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>('get_config', { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke('set_config', { key, value });
}

export async function testGitLabConnection(url: string, token: string): Promise<boolean> {
  return invoke<boolean>('test_gitlab_connection', { url, token });
}

export async function testGitHubConnection(username: string, token: string): Promise<boolean> {
  return invoke<boolean>('test_github_connection', { username, token });
}

export async function pickDirectory(): Promise<string | null> {
  return invoke<string | null>('pick_directory');
}

export async function getProjects(): Promise<ProjectConfig[]> {
  const raw = await getConfig('projects');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map(normalizeProjectConfig);
  } catch {
    return [];
  }
}

export async function saveProjects(projects: ProjectConfig[]): Promise<void> {
  await setConfig('projects', JSON.stringify(projects.map(normalizeProjectConfig)));
}

export async function getActiveProjectId(): Promise<string | null> {
  return getConfig('active_project_id');
}

export async function setActiveProjectId(projectId: string): Promise<void> {
  await setConfig('active_project_id', projectId);
}

export async function getLlmProviders(): Promise<LlmProviderConfig[]> {
  const raw = await getConfig('llm_providers');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveLlmProviders(providers: LlmProviderConfig[]): Promise<void> {
  await setConfig('llm_providers', JSON.stringify(providers));
}

export async function getGitHubAccounts(): Promise<GitHubAccountConfig[]> {
  const raw = await getConfig('github_accounts');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
  } catch {
    return [];
  }
}

export async function saveGitHubAccounts(accounts: GitHubAccountConfig[]): Promise<void> {
  await setConfig('github_accounts', JSON.stringify(accounts));
}

function normalizeProjectConfig(project: ProjectConfig): ProjectConfig {
  const models = normalizeProjectModels(project.models);
  const sourceModelFolder = normalizeSourceModelFolder(project.sourceModelFolder, models);

  return {
    ...project,
    name: project.name?.trim?.() || '',
    basePath: project.basePath?.trim?.() || '',
    models,
    defaultSubmitRepo: project.defaultSubmitRepo?.trim() || null,
    sourceModelFolder,
  };
}

function normalizeProjectModels(models: string[] | null | undefined): string[] {
  const normalized = (models ?? [])
    .map((model) => model.trim())
    .filter(Boolean);

  const unique = Array.from(new Set(normalized.map((model) => model.toUpperCase() === 'ORIGIN' ? 'ORIGIN' : model)));
  if (!unique.length) {
    return ['ORIGIN'];
  }

  const withoutOrigin = unique.filter((model) => model.toUpperCase() !== 'ORIGIN');
  return ['ORIGIN', ...withoutOrigin];
}

function normalizeSourceModelFolder(
  sourceModelFolder: string | null | undefined,
  models: string[],
): string {
  const normalizedSource = sourceModelFolder?.trim();
  if (!normalizedSource) {
    return 'ORIGIN';
  }

  const matched = models.find((model) => model.toUpperCase() === normalizedSource.toUpperCase());
  return matched ?? 'ORIGIN';
}
