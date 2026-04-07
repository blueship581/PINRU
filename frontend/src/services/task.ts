import { callService } from './wails';

export interface TaskFromDB {
  id: string;
  gitlabProjectId: number;
  projectName: string;
  status: string;
  localPath: string | null;
  promptText: string | null;
  createdAt: number;
  updatedAt: number;
  notes: string | null;
  projectConfigId: string | null;
}

export interface ModelRunFromDB {
  id: string;
  taskId: string;
  modelName: string;
  branchName: string | null;
  localPath: string | null;
  prUrl: string | null;
  originUrl: string | null;
  gsbScore: string | null;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  sessionId: string | null;
  conversationRounds: number;
  conversationDate: number | null;
}

export interface CreateTaskRequest {
  gitlabProjectId: number;
  projectName: string;
  localPath: string | null;
  models: string[];
  projectConfigId?: string | null;
}

export interface UpdateModelRunRequest {
  taskId: string;
  modelName: string;
  status: string;
  branchName?: string | null;
  prUrl?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
}

export async function listTasks(projectConfigId?: string): Promise<TaskFromDB[]> {
  return callService<TaskFromDB[]>('TaskService', 'ListTasks', projectConfigId ?? null);
}

export async function getTask(id: string): Promise<TaskFromDB | null> {
  return callService<TaskFromDB | null>('TaskService', 'GetTask', id);
}

export async function listModelRuns(taskId: string): Promise<ModelRunFromDB[]> {
  return callService<ModelRunFromDB[]>('TaskService', 'ListModelRuns', taskId);
}

export async function createTask(task: CreateTaskRequest): Promise<TaskFromDB> {
  return callService<TaskFromDB>('TaskService', 'CreateTask', task);
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  return callService('TaskService', 'UpdateTaskStatus', id, status);
}

export async function updateModelRun(request: UpdateModelRunRequest): Promise<void> {
  return callService('TaskService', 'UpdateModelRun', request);
}

export async function deleteTask(id: string): Promise<void> {
  return callService('TaskService', 'DeleteTask', id);
}

export interface UpdateModelRunSessionRequest {
  id: string;
  sessionId?: string | null;
  conversationRounds: number;
  conversationDate?: number | null;
}

export async function updateModelRunSessionInfo(req: UpdateModelRunSessionRequest): Promise<void> {
  return callService('TaskService', 'UpdateModelRunSessionInfo', req);
}
