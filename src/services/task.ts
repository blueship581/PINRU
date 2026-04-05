import { invoke } from '@tauri-apps/api/core';

export interface TaskFromDB {
  id: string;
  gitlab_project_id: number;
  project_name: string;
  status: string;
  local_path: string | null;
  prompt_text: string | null;
  created_at: string;
  updated_at: string;
  notes: string | null;
}

export interface ModelRunFromDB {
  id: string;
  task_id: string;
  model_name: string;
  branch_name: string | null;
  local_path: string | null;
  pr_url: string | null;
  origin_url: string | null;
  gsb_score: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateTaskRequest {
  gitlab_project_id: number;
  project_name: string;
  local_path: string | null;
  models: string[];
}

export interface UpdateModelRunRequest {
  taskId: string;
  modelName: string;
  status: string;
  branchName?: string | null;
  prUrl?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export async function listTasks(): Promise<TaskFromDB[]> {
  return invoke<TaskFromDB[]>('list_tasks');
}

export async function getTask(id: string): Promise<TaskFromDB | null> {
  return invoke<TaskFromDB | null>('get_task', { id });
}

export async function listModelRuns(taskId: string): Promise<ModelRunFromDB[]> {
  return invoke<ModelRunFromDB[]>('list_model_runs', { taskId });
}

export async function createTask(task: CreateTaskRequest): Promise<TaskFromDB> {
  return invoke<TaskFromDB>('create_task', { task });
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  return invoke('update_task_status', { id, status });
}

export async function updateModelRun(request: UpdateModelRunRequest): Promise<void> {
  return invoke('update_model_run', { request });
}

export async function deleteTask(id: string): Promise<void> {
  return invoke('delete_task', { id });
}
