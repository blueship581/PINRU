import { callService } from './wails';
import { Events } from '@wailsio/runtime';

export type ThinkingDepth = '' | 'think' | 'think harder' | 'ultrathink';
export type ExecMode = 'agent' | 'plan';
export type PermissionMode = 'default' | 'yolo' | 'bypassPermissions';

export interface StartClaudeRequest {
  workDir: string;
  prompt: string;
  model: string;
  thinkingDepth: ThinkingDepth;
  mode: ExecMode;
  permissionMode?: PermissionMode;
  additionalDirs?: string[];
}

export interface StartClaudeResponse {
  sessionId: string;
}

export interface PollOutputResponse {
  lines: string[];
  done: boolean;
  errMsg: string;
}

export async function checkCLI(): Promise<string> {
  return callService('CliService', 'CheckCLI');
}

export async function startClaude(req: StartClaudeRequest): Promise<StartClaudeResponse> {
  return callService('CliService', 'StartClaude', req);
}

export async function pollOutput(sessionId: string, offset: number): Promise<PollOutputResponse> {
  return callService('CliService', 'PollOutput', { sessionId, offset });
}

export async function cancelSession(sessionId: string): Promise<void> {
  return callService('CliService', 'CancelSession', sessionId);
}

export interface SkillItem {
  name: string;
  description: string;
}

export async function listSkills(): Promise<SkillItem[]> {
  return callService('CliService', 'ListSkills');
}

// ── Real-time event subscriptions ─────────────────────────────────────────────

/**
 * Subscribe to individual output lines emitted by a CLI session.
 * Returns a cancel function that unsubscribes the listener.
 */
export function onCLILine(sessionId: string, callback: (line: string) => void): () => void {
  return Events.On(`cli:line:${sessionId}`, (event: { data: string }) => callback(event.data));
}

/**
 * Subscribe to the done signal emitted when a CLI session completes.
 * The callback receives an error message string (empty string on success).
 * Returns a cancel function that unsubscribes the listener.
 */
export function onCLIDone(sessionId: string, callback: (errMsg: string) => void): () => void {
  return Events.On(`cli:done:${sessionId}`, (event: { data: string }) => callback(event.data ?? ''));
}
