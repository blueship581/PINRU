import { invoke } from '@tauri-apps/api/core';

export interface SubmitModelRunRequest {
  taskId: string;
  modelName: string;
  targetRepo: string;
  githubUsername: string;
  githubToken: string;
}

export interface PublishSourceRepoRequest {
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
  return invoke<PublishSourceRepoResult>('publish_source_repo', { request });
}

export async function submitModelRun(
  request: SubmitModelRunRequest,
): Promise<SubmitModelRunResult> {
  return invoke<SubmitModelRunResult>('submit_model_run', { request });
}
