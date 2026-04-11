import { callService } from './wails';

export interface SubmitModelRunRequest {
  githubAccountId?: string;
  taskId: string;
  modelName: string;
  targetRepo: string;
  githubUsername: string;
  githubToken: string;
}

export interface PublishSourceRepoRequest {
  githubAccountId?: string;
  taskId: string;
  modelName: string;
  targetRepo: string;
  githubUsername: string;
  githubToken: string;
}

export interface PublishSourceRepoResult {
  branchName: string;
  repoUrl: string;
}

export interface SubmitModelRunResult {
  branchName: string;
  prUrl: string;
}

export async function publishSourceRepo(
  request: PublishSourceRepoRequest,
): Promise<PublishSourceRepoResult> {
  return callService('SubmitService', 'PublishSourceRepo', request);
}

export async function submitModelRun(
  request: SubmitModelRunRequest,
): Promise<SubmitModelRunResult> {
  return callService('SubmitService', 'SubmitModelRun', request);
}

export interface SubmitAllRequest {
  githubAccountId?: string;
  taskId: string;
  models: string[];
  targetRepo: string;
  sourceModelName?: string;
  githubUsername: string;
  githubToken: string;
}

export interface ModelSubmitResult {
  modelName: string;
  prUrl: string;
  error: string;
}

export interface SubmitAllResult {
  repoUrl: string;
  repoError: string;
  models: ModelSubmitResult[];
}

export async function submitAll(request: SubmitAllRequest): Promise<SubmitAllResult> {
  return callService('SubmitService', 'SubmitAll', request);
}
