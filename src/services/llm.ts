import { invoke } from '@tauri-apps/api/core';

export type LlmProviderType = 'openai_compatible' | 'anthropic';

export interface LlmProviderConfig {
  id: string;
  name: string;
  providerType: LlmProviderType;
  model: string;
  baseUrl?: string | null;
  apiKey: string;
  isDefault: boolean;
}

export interface GeneratePromptRequest {
  taskId: string;
  providerId?: string | null;
  taskType: string;
  scopes: string[];
  constraints: string[];
  additionalNotes?: string | null;
}

export interface AnalyzedFileSnippet {
  path: string;
  snippet: string;
}

export interface CodeAnalysisSummary {
  repoPath: string;
  totalFiles: number;
  detectedStack: string[];
  fileTree: string[];
  keyFiles: AnalyzedFileSnippet[];
}

export interface PromptGenerationResult {
  promptText: string;
  analysis: CodeAnalysisSummary;
  providerName: string;
  model: string;
  status: string;
}

export async function testLlmProvider(provider: LlmProviderConfig): Promise<boolean> {
  return invoke<boolean>('test_llm_provider', { provider });
}

export async function generateTaskPrompt(
  request: GeneratePromptRequest,
): Promise<PromptGenerationResult> {
  return invoke<PromptGenerationResult>('generate_task_prompt', { request });
}

export async function saveTaskPrompt(taskId: string, promptText: string): Promise<void> {
  return invoke('save_task_prompt', { taskId, promptText });
}
