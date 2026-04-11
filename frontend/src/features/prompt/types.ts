export interface LiveMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: boolean;
}

export interface TaskWorkspaceOption {
  id: string;
  label: string;
  path: string;
  isSource: boolean;
}
