import type { Dispatch, SetStateAction } from 'react';
import type { GitHubAccountConfig } from '../../../api/config';
import type { LlmProviderConfig, LlmProviderType } from '../../../api/llm';

type SaveStatus = 'idle' | 'saved' | 'error';

export function defaultBaseUrl(providerType: LlmProviderType) {
  return providerType === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
}

export function providerTypeLabel(providerType: LlmProviderType) {
  return providerType === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容';
}

export function normalizeProviders(providers: LlmProviderConfig[]) {
  if (!providers.length) return [];

  const hasDefault = providers.some((provider) => provider.isDefault);
  return providers.map((provider, index) => ({
    ...provider,
    hasApiKey: provider.hasApiKey ?? Boolean(provider.apiKey),
    providerType: normalizeProviderType(provider.providerType),
    isDefault: hasDefault ? provider.isDefault : index === 0,
  }));
}

export function normalizeProviderType(providerType: string | null | undefined): LlmProviderType {
  return providerType === 'anthropic' ? 'anthropic' : 'openai_compatible';
}

export function normalizeGitHubAccounts(accounts: GitHubAccountConfig[]) {
  if (!accounts.length) return [];

  const hasDefault = accounts.some((account) => account.isDefault);
  return accounts.map((account, index) => ({
    ...account,
    hasToken: account.hasToken ?? Boolean(account.token),
    isDefault: hasDefault ? account.isDefault : index === 0,
  }));
}

export function validateGitLabSettings(url: string, token: string, hasStoredToken: boolean) {
  const trimmedURL = url.trim();
  const trimmedToken = token.trim();

  if (!trimmedURL) {
    return 'GitLab 服务器地址不能为空';
  }
  if (!/^https?:\/\//i.test(trimmedURL)) {
    return 'GitLab 服务器地址必须以 http:// 或 https:// 开头';
  }
  if (!trimmedToken && !hasStoredToken) {
    return 'GitLab 访问令牌不能为空';
  }

  return '';
}

export function formatErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = Reflect.get(error, 'message');
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

export function maskSecret(value: string) {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}

export function describeSecret(hasSecret: boolean, value: string) {
  if (!hasSecret) {
    return '未保存';
  }
  if (!value) {
    return '已保存';
  }
  return maskSecret(value);
}

export function flashStatus(
  setter: Dispatch<SetStateAction<SaveStatus>>,
  next: Exclude<SaveStatus, 'idle'>,
  delay = 2000,
) {
  setter(next);
  setTimeout(() => setter('idle'), delay);
}
