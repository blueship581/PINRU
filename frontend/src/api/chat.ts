import { callService } from './wails';

export interface ChatSession {
  id: string;
  taskId: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SessionWithMessages {
  session: ChatSession;
  messages: ChatMessage[];
}

export interface SendMessageRequest {
  sessionId: string;
  content: string;
  model: string;
  thinkingDepth: string;
  mode: string;
  workDir: string;
  permissionMode?: string; // "" | "yolo"
  autoSavePrompt?: boolean;
}

export interface SendMessageResponse {
  userMessageId: string;
  cliSessionId: string;
  assistantMessageId: string;
}

export async function createSession(taskId: string, model: string): Promise<ChatSession> {
  return callService('ChatService', 'CreateSession', { taskId, model });
}

export async function listSessions(taskId: string, model: string): Promise<ChatSession[]> {
  return callService('ChatService', 'ListSessions', taskId, model);
}

export async function getSessionWithMessages(sessionId: string): Promise<SessionWithMessages> {
  return callService('ChatService', 'GetSessionWithMessages', sessionId);
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  return callService('ChatService', 'RenameSession', sessionId, title);
}

export async function deleteSession(sessionId: string): Promise<void> {
  return callService('ChatService', 'DeleteSession', sessionId);
}

export async function sendMessage(req: SendMessageRequest): Promise<SendMessageResponse> {
  return callService('ChatService', 'SendMessage', req);
}

export async function getMessage(messageId: string): Promise<ChatMessage> {
  return callService('ChatService', 'GetMessage', messageId);
}

export async function saveMessageAsPrompt(taskId: string, messageId: string): Promise<void> {
  return callService('ChatService', 'SaveMessageAsPrompt', taskId, messageId);
}
