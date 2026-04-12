import { callService } from './wails';

export interface BackgroundJob {
  id: string;
  jobType: string;
  taskId: string | null;
  status: 'pending' | 'running' | 'done' | 'error' | 'cancelled';
  progress: number;
  progressMessage: string | null;
  errorMessage: string | null;
  inputPayload: string;
  outputPayload: string | null;
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface SubmitJobRequest {
  jobType: string;
  taskId: string;
  inputPayload: string;
  maxRetries?: number;
  timeoutSeconds?: number;
}

export interface JobFilter {
  status?: string;
  taskId?: string;
}

export interface JobProgressEvent {
  id: string;
  jobType: string;
  taskId: string | null;
  status: string;
  progress: number;
  progressMessage: string | null;
  errorMessage: string | null;
}

export interface GitCloneCopyTarget {
  modelId: string;
  path: string;
}

export interface GitClonePayload {
  cloneUrl: string;
  sourcePath: string;
  sourceModelId: string;
  copyTargets: GitCloneCopyTarget[];
}

export interface GitCloneFailure {
  modelId: string;
  message: string;
}

export interface GitCloneResult {
  sourcePath: string;
  successfulModels: string[];
  failedModels: GitCloneFailure[];
}

export async function submitJob(req: SubmitJobRequest): Promise<BackgroundJob> {
  return callService('JobService', 'SubmitJob', req);
}

export async function listJobs(filter?: JobFilter | null): Promise<BackgroundJob[]> {
  return callService('JobService', 'ListJobs', filter ?? null);
}

export async function getJob(id: string): Promise<BackgroundJob | null> {
  return callService('JobService', 'GetJob', id);
}

export async function retryJob(id: string): Promise<BackgroundJob> {
  return callService('JobService', 'RetryJob', id);
}

export async function cancelJob(id: string): Promise<void> {
  return callService('JobService', 'CancelJob', id);
}
