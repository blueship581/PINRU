import type { GitLabProject } from '../../api/git';

export type ModelEntry = {
  id: string;
  name: string;
  checked: boolean;
  status: 'pending' | 'cloning' | 'copying' | 'done' | 'error';
};

export type ProjectLookup = {
  id: string;
  project?: GitLabProject;
  error?: string;
};

export type ClaimResult = {
  projectId: string;
  projectName: string;
  localPath: string;
  status: 'pending' | 'running' | 'done' | 'partial' | 'error';
  message: string;
  modelStatuses: Map<string, ModelEntry['status']>;
};

export type ClonePlanResult = {
  successfulModels: string[];
  failedModels: Array<{ modelId: string; message: string }>;
};

export type Phase = 'input' | 'review' | 'running' | 'done';
