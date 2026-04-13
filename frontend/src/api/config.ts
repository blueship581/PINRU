import { callService } from './wails';
import type { LlmProviderConfig } from './llm';
import {
  buildTaskTypeChangeConfirmMessage,
  buildProjectTaskTypes,
  DEFAULT_TASK_TYPE,
  DEFAULT_TASK_TYPES,
  dedupeTaskTypes,
  getProjectTaskSettings,
  getTaskTypeQuotaValue,
  getTaskTypeDisplayLabel,
  getTaskTypeQuotaRawValue,
  getTaskTypePresentation,
  normalizeTaskTypeName,
  parseProjectTaskTypes,
  parseTaskTypeQuotas,
  serializeProjectTaskSettings,
  serializeProjectTaskTypes,
  serializeTaskTypeQuotas,
  type ProjectTaskSettings,
  type SerializedProjectTaskSettings,
  type TaskType,
  type TaskTypeQuotas,
} from '../shared/lib/taskTypes';

export type {
  ProjectTaskSettings,
  SerializedProjectTaskSettings,
  TaskType,
  TaskTypeQuotas,
};
export {
  buildTaskTypeChangeConfirmMessage,
  buildProjectTaskTypes,
  DEFAULT_TASK_TYPE,
  DEFAULT_TASK_TYPES,
  dedupeTaskTypes,
  getProjectTaskSettings,
  getTaskTypeQuotaValue,
  getTaskTypeDisplayLabel,
  getTaskTypeQuotaRawValue,
  getTaskTypePresentation,
  normalizeTaskTypeName,
  parseProjectTaskTypes,
  parseTaskTypeQuotas,
  serializeProjectTaskSettings,
  serializeProjectTaskTypes,
  serializeTaskTypeQuotas,
};

export interface ProjectConfig {
  id: string;
  name: string;
  gitlabUrl: string;
  gitlabToken: string;
  hasGitLabToken: boolean;
  cloneBasePath: string;
  models: string;
  sourceModelFolder: string;
  defaultSubmitRepo: string;
  taskTypes: string;
  taskTypeQuotas: string;
  taskTypeTotals: string;
  overviewMarkdown: string;
  createdAt: number;
  updatedAt: number;
}

export interface GitHubAccountConfig {
  id: string;
  name: string;
  username: string;
  token: string;
  hasToken: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GitLabSettings {
  url: string;
  username: string;
  hasToken: boolean;
}

export interface TraeSettings {
  workspaceStoragePath: string;
  logsPath: string;
  defaultWorkspaceStoragePath: string;
  defaultLogsPath: string;
}

export async function getConfig(key: string): Promise<string> {
  return callService('ConfigService', 'GetConfig', key);
}

export async function setConfig(key: string, value: string): Promise<void> {
  return callService('ConfigService', 'SetConfig', key, value);
}

export async function testGitLabConnection(url: string, token: string): Promise<boolean> {
  return callService('ConfigService', 'TestGitLabConnection', url, token);
}

export async function testGitHubConnection(username: string, token: string): Promise<boolean> {
  return callService('ConfigService', 'TestGitHubConnection', username, token);
}

export async function testGitHubAccountConnection(
  id: string,
  username: string,
  token: string,
): Promise<boolean> {
  return callService('ConfigService', 'TestGitHubAccountConnection', id, username, token);
}

export async function getGitLabSettings(): Promise<GitLabSettings> {
  return callService('ConfigService', 'GetGitLabSettings');
}

export async function saveGitLabSettings(url: string, username: string, token: string): Promise<void> {
  return callService('ConfigService', 'SaveGitLabSettings', url, username, token);
}

export async function getTraeSettings(): Promise<TraeSettings> {
  return callService('ConfigService', 'GetTraeSettings');
}

export async function saveTraeSettings(workspaceStoragePath: string, logsPath: string): Promise<void> {
  return callService('ConfigService', 'SaveTraeSettings', workspaceStoragePath, logsPath);
}

// Project CRUD — now backed by dedicated DB table
export async function getProjects(): Promise<ProjectConfig[]> {
  return callService('ConfigService', 'ListProjects');
}

export async function createProject(p: ProjectConfig): Promise<void> {
  return callService('ConfigService', 'CreateProject', p);
}

export async function updateProject(p: ProjectConfig): Promise<void> {
  return callService('ConfigService', 'UpdateProject', p);
}

export async function deleteProject(id: string): Promise<void> {
  return callService('ConfigService', 'DeleteProject', id);
}

export async function consumeProjectQuota(projectId: string, taskType: string): Promise<void> {
  return callService('ConfigService', 'ConsumeProjectQuota', projectId, taskType);
}

// LLM Provider CRUD
export async function getLlmProviders(): Promise<LlmProviderConfig[]> {
  return callService('ConfigService', 'ListLLMProviders');
}

export async function createLlmProvider(p: LlmProviderConfig): Promise<void> {
  return callService('ConfigService', 'CreateLLMProvider', p);
}

export async function updateLlmProvider(p: LlmProviderConfig): Promise<void> {
  return callService('ConfigService', 'UpdateLLMProvider', p);
}

export async function deleteLlmProvider(id: string): Promise<void> {
  return callService('ConfigService', 'DeleteLLMProvider', id);
}

// GitHub Account CRUD
export async function getGitHubAccounts(): Promise<GitHubAccountConfig[]> {
  return callService('ConfigService', 'ListGitHubAccounts');
}

export async function createGitHubAccount(a: GitHubAccountConfig): Promise<void> {
  return callService('ConfigService', 'CreateGitHubAccount', a);
}

export async function updateGitHubAccount(a: GitHubAccountConfig): Promise<void> {
  return callService('ConfigService', 'UpdateGitHubAccount', a);
}

export async function deleteGitHubAccount(id: string): Promise<void> {
  return callService('ConfigService', 'DeleteGitHubAccount', id);
}

// Active project
export async function getActiveProjectId(): Promise<string> {
  return getConfig('active_project_id');
}

export async function setActiveProjectId(projectId: string): Promise<void> {
  await setConfig('active_project_id', projectId);
}

// Model normalization helpers (kept for frontend use)
export function normalizeProjectModels(modelsStr: string): string[] {
  const trimmed = modelsStr.trim();
  let rawModels: string[] = [];

  if (!trimmed) {
    rawModels = [];
  } else if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        rawModels = parsed.map((item) => String(item));
      }
    } catch {
      rawModels = trimmed.split(/[,\n]/);
    }
  } else {
    rawModels = trimmed.split(/[,\n]/);
  }

  const models = rawModels
    .map((m) => m.trim())
    .filter(Boolean);

  const unique = Array.from(
    new Set(models.map((m) => (m.toUpperCase() === 'ORIGIN' ? 'ORIGIN' : m))),
  );
  if (!unique.length) return ['ORIGIN'];

  const withoutOrigin = unique.filter((m) => m.toUpperCase() !== 'ORIGIN');
  return ['ORIGIN', ...withoutOrigin];
}

export function serializeProjectModels(modelNames: string[]): string {
  return normalizeProjectModels(modelNames.join(',')).join(',');
}
