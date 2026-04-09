import { callService } from './wails';

export type PromptGenerationStatus = 'idle' | 'running' | 'done' | 'error';

export interface TaskSession {
  sessionId: string;
  taskType: string;
  consumeQuota: boolean;
  isCompleted?: boolean | null;
  isSatisfied?: boolean | null;
  evaluation?: string;
  userConversation?: string;
}

export interface ExtractedTraeSession {
  sessionId: string;
  userConversation: string;
  userMessageCount: number;
  firstUserMessage: string;
  lastActivityAt: number | null;
  isCurrent: boolean;
}

export interface ExtractTaskSessionCandidate {
  id: string;
  workspacePath: string;
  matchedPath: string;
  matchKind: 'exact' | 'child' | 'parent' | string;
  sessionCount: number;
  userId: string;
  currentSessionId: string;
  userMessageCount: number;
  summary: string;
  lastActivityAt: number | null;
  sessions: ExtractedTraeSession[];
}

export interface ExtractTaskSessionsResult {
  taskId: string;
  candidates: ExtractTaskSessionCandidate[];
}

export interface TaskFromDB {
  id: string;
  gitlabProjectId: number;
  projectName: string;
  status: string;
  taskType: string;
  sessionList: TaskSession[];
  localPath: string | null;
  promptText: string | null;
  promptGenerationStatus: PromptGenerationStatus;
  promptGenerationError: string | null;
  promptGenerationStartedAt: number | null;
  promptGenerationFinishedAt: number | null;
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
  submitError: string | null;
}

export interface CreateTaskRequest {
  gitlabProjectId: number;
  projectName: string;
  taskType?: string;
  localPath: string | null;
  sourceModelName?: string | null;
  sourceLocalPath?: string | null;
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

export async function updateTaskType(id: string, taskType: string): Promise<void> {
  return callService('TaskService', 'UpdateTaskType', id, taskType);
}

export interface UpdateTaskSessionListRequest {
  id: string;
  sessionList: TaskSession[];
}

export async function updateTaskSessionList(req: UpdateTaskSessionListRequest): Promise<void> {
  return callService('TaskService', 'UpdateTaskSessionList', req);
}

export async function extractTaskSessions(taskId: string): Promise<ExtractTaskSessionsResult> {
  return callService<ExtractTaskSessionsResult>('TaskService', 'ExtractTaskSessions', taskId);
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

export interface AddModelRunRequest {
  taskId: string;
  modelName: string;
  localPath?: string | null;
}

export async function addModelRun(req: AddModelRunRequest): Promise<void> {
  return callService('TaskService', 'AddModelRun', req);
}

export async function deleteModelRun(taskId: string, modelName: string): Promise<void> {
  return callService('TaskService', 'DeleteModelRun', taskId, modelName);
}
