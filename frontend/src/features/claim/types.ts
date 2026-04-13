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
  claimKey: string;
  projectId: string;
  displayProjectId: string;
  projectName: string;
  claimSequence: number;
  localPath: string;
  status: 'pending' | 'running' | 'done' | 'partial' | 'error' | 'quota_exceeded';
  message: string;
  modelStatuses: Map<string, ModelEntry['status']>;
};

export type ClonePlanResult = {
  successfulModels: string[];
  failedModels: Array<{ modelId: string; message: string }>;
};

export type Phase = 'input' | 'review' | 'running' | 'done';
