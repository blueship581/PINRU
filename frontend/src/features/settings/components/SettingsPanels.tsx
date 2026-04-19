import { type ReactNode, useState } from 'react';
import {
  Bot,
  Check,
  ChevronRight,
  Edit2,
  Github,
  Link2,
  Loader2,
  Plus,
  Search,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { GitHubAccountConfig } from '../../../api/config';
import type { LlmProviderConfig, LlmProviderType } from '../../../api/llm';
import {
  EmptyState,
  ErrorMsg,
  Field,
  IconBtn,
  InfoText,
  MiniBadge,
  SectionHead,
  Spinner,
  StatusBadge,
} from './SettingsPrimitives';
import {
  defaultBaseUrl,
  describeSecret,
  isAcpProvider,
  providerTypeLabel,
} from '../utils/settingsUtils';

const inputCls =
  'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';
const btnPrimary =
  'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 cursor-default';
const btnSecondary =
  'px-5 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default';

export type ProviderFormState = {
  id: string | null;
  name: string;
  providerType: LlmProviderType;
  model: string;
  polishModel: string;
  baseUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  isDefault: boolean;
};

export type ProviderTestResult = {
  status: 'success' | 'error';
  message: string;
};

export const EMPTY_PROVIDER_FORM: ProviderFormState = {
  id: null,
  name: '',
  providerType: 'openai_compatible',
  model: '',
  polishModel: '',
  baseUrl: '',
  apiKey: '',
  hasApiKey: false,
  isDefault: false,
};

export type GitHubAccountFormState = {
  id: string | null;
  name: string;
  username: string;
  token: string;
  hasToken: boolean;
  isDefault: boolean;
};

export const EMPTY_GITHUB_FORM: GitHubAccountFormState = {
  id: null,
  name: '',
  username: '',
  token: '',
  hasToken: false,
  isDefault: false,
};

export function GitLabSettingsPanel({
  loading,
  gitlabLoadError,
  gitlabUrl,
  gitlabToken,
  gitlabUsername,
  gitlabHasToken,
  gitlabSkipTlsVerify,
  gitlabError,
  testingConnection,
  connectionStatus,
  savingGitlab,
  gitlabSaveStatus,
  isGitLabConfigured,
  onGitlabUrlChange,
  onGitlabTokenChange,
  onGitlabUsernameChange,
  onGitlabSkipTlsVerifyChange,
  onTestConnection,
  onSave,
}: {
  loading: boolean;
  gitlabLoadError: string;
  gitlabUrl: string;
  gitlabToken: string;
  gitlabUsername: string;
  gitlabHasToken: boolean;
  gitlabSkipTlsVerify: boolean;
  gitlabError: string;
  testingConnection: boolean;
  connectionStatus: 'idle' | 'success' | 'error';
  savingGitlab: boolean;
  gitlabSaveStatus: 'idle' | 'saved' | 'error';
  isGitLabConfigured: boolean;
  onGitlabUrlChange: (value: string) => void;
  onGitlabTokenChange: (value: string) => void;
  onGitlabUsernameChange: (value: string) => void;
  onGitlabSkipTlsVerifyChange: (value: boolean) => void;
  onTestConnection: () => void;
  onSave: () => void;
}) {
  return (
    <section className="max-w-lg animate-in fade-in duration-150">
      <SectionHead title="GitLab 配置" description="用于获取项目信息和鉴权 Clone" />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-stone-400 dark:text-stone-500">带 * 的字段为必填项</p>
          {gitlabLoadError && <ErrorMsg msg={gitlabLoadError} />}

          <Field label="服务器地址" required hint="必须包含 http:// 或 https://">
            <input
              type="text"
              value={gitlabUrl}
              onChange={(event) => onGitlabUrlChange(event.target.value)}
              placeholder="https://gitlab.example.com"
              required
              className={inputCls}
            />
          </Field>
          <Field
            label="个人访问令牌 (PAT)"
            required={!gitlabHasToken}
            hint={gitlabHasToken ? '已保存访问令牌；留空则保留当前值' : undefined}
          >
            <input
              type="password"
              value={gitlabToken}
              onChange={(event) => onGitlabTokenChange(event.target.value)}
              placeholder={gitlabHasToken ? '已保存，留空则保留当前令牌' : 'glpat-xxxxxxxxxxxx'}
              required
              className={inputCls}
            />
          </Field>
          <Field label="用户名" hint="可选；留空时默认使用 oauth2 进行 Clone">
            <input
              type="text"
              value={gitlabUsername}
              onChange={(event) => onGitlabUsernameChange(event.target.value)}
              placeholder="your-username"
              className={inputCls}
            />
          </Field>
          <label className="flex items-start gap-3 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <input
              type="checkbox"
              checked={gitlabSkipTlsVerify}
              onChange={(event) => onGitlabSkipTlsVerifyChange(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
            />
            <span className="space-y-1">
              <span className="block font-semibold">临时跳过 TLS 证书校验</span>
              <span className="block text-xs text-amber-700 dark:text-amber-200/80">
                仅在 GitLab 证书过期、自签名或证书链异常时临时启用。会同时影响测试连接、项目查询和 Clone。
              </span>
            </span>
          </label>

          {gitlabError && <ErrorMsg msg={gitlabError} />}

          <div className="pt-5 flex items-center justify-between border-t border-stone-100 dark:border-stone-800">
            <div className="flex items-center gap-3">
              <button
                onClick={onTestConnection}
                disabled={testingConnection || !isGitLabConfigured}
                className={btnSecondary}
              >
                {testingConnection ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
                测试连接
              </button>
              {connectionStatus === 'success' && <StatusBadge ok>已连接</StatusBadge>}
              {connectionStatus === 'error' && <StatusBadge>连接失败</StatusBadge>}
            </div>
            <div className="flex items-center gap-3">
              {gitlabSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
              {gitlabSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
              <button
                onClick={onSave}
                disabled={savingGitlab || !isGitLabConfigured}
                className={btnPrimary}
              >
                {savingGitlab && <Loader2 className="w-4 h-4 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function GitHubAccountsPanel({
  githubLoadError,
  githubSaveStatus,
  githubAccounts,
  testingGithubAccountId,
  githubConnectionStatus,
  onCreateAccount,
  onSetDefaultAccount,
  onTestAccount,
  onEditAccount,
  onDeleteAccount,
}: {
  githubLoadError: string;
  githubSaveStatus: 'idle' | 'saved' | 'error';
  githubAccounts: GitHubAccountConfig[];
  testingGithubAccountId: string;
  githubConnectionStatus: Record<string, 'success' | 'error'>;
  onCreateAccount: () => void;
  onSetDefaultAccount: (accountId: string) => void;
  onTestAccount: (account: GitHubAccountConfig) => void;
  onEditAccount: (account: GitHubAccountConfig) => void;
  onDeleteAccount: (accountId: string) => void;
}) {
  return (
    <section className="animate-in fade-in duration-150">
      <SectionHead
        title="GitHub 账号"
        description="提交中心会直接读取这里的默认账号、默认仓库和访问令牌"
      />

      <div className="max-w-3xl">
        {githubLoadError && (
          <div className="mb-5">
            <ErrorMsg msg={githubLoadError} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="text-sm text-stone-500 dark:text-stone-400">
            先完成本地账号和仓库偏好管理，后续接入真实 push / PR API 时可直接复用这套配置。
          </div>
          <div className="flex items-center gap-3">
            {githubSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
            {githubSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
            <button onClick={onCreateAccount} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              添加账号
            </button>
          </div>
        </div>

        {!githubAccounts.length ? (
          <EmptyState
            title="还没有配置 GitHub 账号"
            description="添加至少一个账号后，提交中心才能读取默认仓库、分支和 PR 发布目标。"
            icon={<Github className="w-5 h-5" />}
          />
        ) : (
          <div className="space-y-3">
            {githubAccounts.map((account) => (
              <div
                key={account.id}
                className="p-5 rounded-3xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                        {account.name}
                      </span>
                      {account.isDefault && <MiniBadge ok>默认</MiniBadge>}
                      <MiniBadge>@{account.username}</MiniBadge>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-stone-500 dark:text-stone-400">
                      <p>用户名: {account.username}</p>
                      <p>访问令牌: {describeSecret(account.hasToken, account.token)}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!account.isDefault && (
                      <button
                        onClick={() => onSetDefaultAccount(account.id)}
                        className={btnSecondary}
                      >
                        <ShieldCheck className="w-4 h-4" />
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => onTestAccount(account)}
                      disabled={testingGithubAccountId === account.id}
                      className={btnSecondary}
                    >
                      {testingGithubAccountId === account.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4" />
                      )}
                      测试连接
                    </button>
                    <IconBtn title="编辑" onClick={() => onEditAccount(account)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="删除"
                      danger
                      onClick={() => onDeleteAccount(account.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                </div>

                {githubConnectionStatus[account.id] && (
                  <div className="mt-4 pt-4 border-t border-stone-200 dark:border-stone-700">
                    {githubConnectionStatus[account.id] === 'success' ? (
                      <StatusBadge ok>连接成功</StatusBadge>
                    ) : (
                      <StatusBadge>连接失败</StatusBadge>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---- Provider icon helpers ----
function ProviderIcon({ providerType, name }: { providerType: LlmProviderType; name: string }) {
  if (providerType === 'claude_code_acp') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#CC785C]/10 text-[#CC785C] text-sm font-bold flex-shrink-0">
        {'> _'}
      </span>
    );
  }
  if (providerType === 'codex_acp') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 flex-shrink-0">
        <Terminal className="w-4 h-4" />
      </span>
    );
  }
  if (providerType === 'anthropic') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex-shrink-0">
        <Bot className="w-4 h-4" />
      </span>
    );
  }
  // openai_compatible — derive color from name
  const colors = [
    'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400',
    'bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-400',
    'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400',
  ];
  const idx = name.charCodeAt(0) % colors.length;
  return (
    <span
      className={`flex items-center justify-center w-8 h-8 rounded-xl ${colors[idx]} text-sm font-bold flex-shrink-0`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function LlmProvidersPanel({
  llmLoadError,
  llmSaveStatus,
  llmProviders,
  testingProviderId,
  providerTestStatus,
  onCreateProvider,
  onCreateAcpProvider,
  onSetDefaultProvider,
  onTestProvider,
  onEditProvider,
  onDeleteProvider,
}: {
  llmLoadError: string;
  llmSaveStatus: 'idle' | 'saved' | 'error';
  llmProviders: LlmProviderConfig[];
  testingProviderId: string;
  providerTestStatus: Record<string, ProviderTestResult>;
  onCreateProvider: () => void;
  onCreateAcpProvider: () => void;
  onSetDefaultProvider: (providerId: string) => void;
  onTestProvider: (provider: LlmProviderConfig) => void;
  onEditProvider: (provider: LlmProviderConfig) => void;
  onDeleteProvider: (providerId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    llmProviders.length > 0 ? llmProviders[0].id : null,
  );
  const [search, setSearch] = useState('');

  const selected = llmProviders.find((p) => p.id === selectedId) ?? llmProviders[0] ?? null;

  const filtered = search.trim()
    ? llmProviders.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.model.toLowerCase().includes(search.toLowerCase()),
      )
    : llmProviders;

  const testResult = selected ? providerTestStatus[selected.id] : null;
  const isTesting = selected ? testingProviderId === selected.id : false;

  return (
    <section className="animate-in fade-in duration-150 h-full flex flex-col">
      <SectionHead
        title="提供商"
        description="配置 AI 模型提供商，支持 ACP 协议和 OpenAI 兼容接口"
      />

      {llmLoadError && (
        <div className="mb-4">
          <ErrorMsg msg={llmLoadError} />
        </div>
      )}

      {/* Top action bar */}
      <div className="flex items-center justify-end gap-2 mb-4">
        {llmSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
        {llmSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
        <button
          onClick={onCreateAcpProvider}
          className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium transition-colors flex items-center gap-1.5 cursor-default"
        >
          <Terminal className="w-3.5 h-3.5" />
          添加 ACP 提供商
        </button>
        <button
          onClick={onCreateProvider}
          className="px-4 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] text-sm font-medium transition-colors flex items-center gap-1.5 cursor-default shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          添加自定义提供商
        </button>
      </div>

      {/* Main split layout */}
      <div className="flex-1 flex gap-0 border border-stone-200 dark:border-stone-700 rounded-2xl overflow-hidden min-h-0" style={{ height: '480px' }}>
        {/* Left: provider list */}
        <div className="w-56 flex-shrink-0 border-r border-stone-200 dark:border-stone-700 flex flex-col bg-stone-50 dark:bg-stone-900/50">
          {/* Search */}
          <div className="p-3 border-b border-stone-200 dark:border-stone-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索提供商..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-slate-400/50 placeholder:text-stone-400 text-stone-700 dark:text-stone-300"
              />
            </div>
          </div>

          {/* Provider list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-center text-xs text-stone-400 py-8">暂无提供商</p>
            ) : (
              filtered.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedId(provider.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-3 text-left transition-colors cursor-default border-b border-stone-200/50 dark:border-stone-700/50 last:border-0 ${
                    selected?.id === provider.id
                      ? 'bg-white dark:bg-stone-800 shadow-sm'
                      : 'hover:bg-white/60 dark:hover:bg-stone-800/40'
                  }`}
                >
                  <ProviderIcon providerType={provider.providerType} name={provider.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                        {provider.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {isAcpProvider(provider.providerType) && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-1.5 py-0.5 rounded-full">
                          ACP
                        </span>
                      )}
                      {provider.isDefault && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full">
                          默认
                        </span>
                      )}
                    </div>
                  </div>
                  {selected?.id === provider.id && (
                    <ChevronRight className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right: provider detail */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selected ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-sm text-stone-400">选择左侧的提供商查看详情</p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ProviderIcon providerType={selected.providerType} name={selected.name} />
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-stone-900 dark:text-stone-50">
                        {selected.name}
                      </h3>
                      {selected.isDefault && <MiniBadge ok>默认</MiniBadge>}
                      {isAcpProvider(selected.providerType) && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/30 px-2 py-0.5 rounded-full">
                          ACP
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                      {providerTypeLabel(selected.providerType)}
                    </p>
                  </div>
                </div>

                {/* Connect / Test button */}
                <button
                  onClick={() => onTestProvider(selected)}
                  disabled={isTesting}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors flex items-center gap-1.5 cursor-default flex-shrink-0 ${
                    testResult?.status === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                      : testResult?.status === 'error'
                        ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
                        : 'bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] shadow-sm'
                  }`}
                >
                  {isTesting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : testResult?.status === 'success' ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  {isTesting
                    ? '测试中...'
                    : testResult?.status === 'success'
                      ? '已连接'
                      : testResult?.status === 'error'
                        ? '连接失败'
                        : '测试连接'}
                </button>
              </div>

              {/* Connection error */}
              {testResult?.status === 'error' && (
                <div className="rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 px-4 py-3">
                  <p className="text-xs text-red-600 dark:text-red-400">{testResult.message}</p>
                </div>
              )}

              {/* Info grid */}
              <div className="rounded-xl border border-stone-200 dark:border-stone-700 divide-y divide-stone-100 dark:divide-stone-800 overflow-hidden">
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">模型</span>
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200 font-mono">
                    {selected.model || '—'}
                  </span>
                </div>
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">Base URL</span>
                  <span className="text-xs text-stone-600 dark:text-stone-300 font-mono truncate max-w-[260px]">
                    {selected.baseUrl?.trim() || defaultBaseUrl(selected.providerType)}
                  </span>
                </div>
                {!isAcpProvider(selected.providerType) && (
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-stone-500 dark:text-stone-400">API Key</span>
                    <span className="text-xs text-stone-600 dark:text-stone-300 font-mono">
                      {describeSecret(Boolean(selected.hasApiKey), selected.apiKey)}
                    </span>
                  </div>
                )}
                <div className="px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">协议类型</span>
                  <span className="text-xs font-semibold text-stone-800 dark:text-stone-200">
                    {providerTypeLabel(selected.providerType)}
                  </span>
                </div>
              </div>

              {/* ACP description */}
              {isAcpProvider(selected.providerType) && (
                <div className="rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-900/30 px-4 py-3">
                  <p className="text-xs text-violet-700 dark:text-violet-400 leading-relaxed">
                    {selected.providerType === 'claude_code_acp'
                      ? 'Claude Code ACP 通过本地 Claude Code CLI 调用，无需配置 API Key。请确保 Claude Code CLI 已安装并登录。'
                      : 'Codex ACP 通过本地 OpenAI Codex CLI 调用，无需配置 API Key。请确保 Codex CLI 已安装并配置。'}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
                {!selected.isDefault && (
                  <button
                    onClick={() => onSetDefaultProvider(selected.id)}
                    className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium transition-colors flex items-center gap-1.5 cursor-default"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    设为默认
                  </button>
                )}
                <button
                  onClick={() => onEditProvider(selected)}
                  className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 text-sm font-medium transition-colors flex items-center gap-1.5 cursor-default"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  编辑
                </button>
                <button
                  onClick={() => onDeleteProvider(selected.id)}
                  className="px-4 py-2 rounded-xl border border-red-200 dark:border-red-900/40 bg-white dark:bg-stone-800 hover:bg-red-50 dark:hover:bg-red-900/10 text-red-600 dark:text-red-400 text-sm font-medium transition-colors flex items-center gap-1.5 cursor-default ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  删除
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function GeneralSettingsPanel({
  theme,
  onThemeChange,
  traeWorkspaceStoragePath,
  traeLogsPath,
  traeDefaultWorkspaceStoragePath,
  traeDefaultLogsPath,
  traePathSaveStatus,
  onTraeWorkspaceStoragePathChange,
  onTraeLogsPathChange,
  onTraePathsSave,
}: {
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  traeWorkspaceStoragePath: string;
  traeLogsPath: string;
  traeDefaultWorkspaceStoragePath: string;
  traeDefaultLogsPath: string;
  traePathSaveStatus: 'idle' | 'saved' | 'error';
  onTraeWorkspaceStoragePathChange: (value: string) => void;
  onTraeLogsPathChange: (value: string) => void;
  onTraePathsSave: () => void;
}) {
  return (
    <section className="max-w-lg animate-in fade-in duration-150">
      <SectionHead title="通用设置" description="选择界面配色，切换后立即生效" />

      <div className="space-y-6">
        <Field label="主题">
          <div className="flex gap-5">
            {(['light', 'dark'] as const).map((nextTheme) => (
              <label key={nextTheme} className="flex items-center gap-2.5 cursor-default">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === nextTheme}
                  onChange={() => onThemeChange(nextTheme)}
                  className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                />
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                  {nextTheme === 'light' ? '浅色' : '深色'}
                </span>
              </label>
            ))}
          </div>
        </Field>

        <div className="pt-4 border-t border-stone-100 dark:border-stone-800">
          <p className="text-sm font-semibold text-stone-800 dark:text-stone-200 mb-1">
            Trae IDE 路径配置
          </p>
          <p className="text-xs text-stone-500 dark:text-stone-400 mb-4">
            用于从 Trae IDE 日志读取 session ID。留空则使用当前平台的默认路径。
          </p>

          <div className="space-y-4">
            <Field
              label="workspaceStorage 路径"
              hint={traeDefaultWorkspaceStoragePath ? `默认：${traeDefaultWorkspaceStoragePath}` : undefined}
            >
              <input
                type="text"
                value={traeWorkspaceStoragePath}
                onChange={(event) => onTraeWorkspaceStoragePathChange(event.target.value)}
                placeholder={traeDefaultWorkspaceStoragePath || '留空使用平台默认路径'}
                className={inputCls}
              />
            </Field>

            <Field
              label="logs 路径"
              hint={traeDefaultLogsPath ? `默认：${traeDefaultLogsPath}` : undefined}
            >
              <input
                type="text"
                value={traeLogsPath}
                onChange={(event) => onTraeLogsPathChange(event.target.value)}
                placeholder={traeDefaultLogsPath || '留空使用平台默认路径'}
                className={inputCls}
              />
            </Field>

            <div className="flex items-center justify-end gap-3">
              {traePathSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
              {traePathSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
              <button onClick={onTraePathsSave} className={btnPrimary}>
                保存路径
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DataManagementPanel() {
  return (
    <section className="max-w-lg animate-in fade-in duration-150">
      <SectionHead
        title="数据管理"
        description="这部分尚未开放，先明确标记为规划中，避免误触后无反馈"
      />
      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
        数据导入、导出和批量清理尚未接入真实逻辑。这里保留规划说明，但相关操作暂时不可点击。
      </div>
      <div className="space-y-3">
        {[
          {
            title: '导出数据',
            desc: '将所有任务和配置导出为 JSON（规划中）',
            btn: '规划中',
          },
          {
            title: '导入数据',
            desc: '从之前导出的 JSON 文件恢复（规划中）',
            btn: '规划中',
          },
        ].map((item) => (
          <div
            key={item.title}
            className="flex items-center justify-between p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700"
          >
            <div>
              <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                {item.title}
              </p>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                {item.desc}
              </p>
            </div>
            <button
              disabled
              className="px-5 py-2.5 rounded-2xl bg-stone-100 dark:bg-stone-800 text-sm font-semibold text-stone-400 dark:text-stone-500 cursor-not-allowed opacity-70"
            >
              {item.btn}
            </button>
          </div>
        ))}
        <div className="flex items-center justify-between p-4 rounded-2xl bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30">
          <div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
              清除已归档任务
            </p>
            <p className="text-xs text-red-500/70 dark:text-red-400/60 mt-0.5">
              批量清理逻辑尚未接入，当前仅保留规划入口
            </p>
          </div>
          <button
            disabled
            className="px-5 py-2.5 rounded-full border border-red-200 bg-white text-sm font-semibold text-red-300 cursor-not-allowed opacity-80 dark:border-red-900/40 dark:bg-stone-900 dark:text-red-500/50"
          >
            规划中
          </button>
        </div>
      </div>
    </section>
  );
}

function SettingsModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">{title}</h2>
            <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GitHubAccountModal({
  form,
  error,
  saving,
  onClose,
  onNameChange,
  onUsernameChange,
  onTokenChange,
  onDefaultChange,
  onSave,
}: {
  form: GitHubAccountFormState;
  error: string;
  saving: boolean;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onDefaultChange: (value: boolean) => void;
  onSave: () => void;
}) {
  return (
    <SettingsModalShell
      title={form.id ? '编辑 GitHub 账号' : '添加 GitHub 账号'}
      description="供提交中心读取默认账号身份、令牌和默认仓库"
      onClose={onClose}
    >
      <div className="space-y-4">
        <p className="text-xs text-stone-400 dark:text-stone-500">带 * 的字段为必填项</p>

        <Field label="账号名称" required hint="例如：work-account / personal">
          <input
            type="text"
            value={form.name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="例如：work-account"
            required
            className={inputCls}
          />
        </Field>

        <Field label="GitHub 用户名" required>
          <input
            type="text"
            value={form.username}
            onChange={(event) => onUsernameChange(event.target.value)}
            placeholder="例如：blueship581"
            required
            className={inputCls}
          />
        </Field>

        <Field
          label="访问令牌"
          required={!form.id || !form.hasToken}
          hint={form.id && form.hasToken ? '已保存访问令牌；留空则保留当前值' : undefined}
        >
          <input
            type="password"
            value={form.token}
            onChange={(event) => onTokenChange(event.target.value)}
            placeholder={form.id && form.hasToken ? '留空则保留当前值' : 'ghp_...'}
            required
            className={inputCls}
          />
        </Field>

        <label className="flex items-center gap-2.5 cursor-default">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(event) => onDefaultChange(event.target.checked)}
            className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
          />
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            设为默认账号
          </span>
        </label>

        {error && <ErrorMsg msg={error} />}

        <div className="pt-5 flex items-center justify-end gap-3 border-t border-stone-100 dark:border-stone-800">
          <button onClick={onClose} className={btnSecondary}>
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving || !form.name.trim() || !form.username.trim()}
            className={btnPrimary}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </SettingsModalShell>
  );
}

export function ProviderModal({
  form,
  error,
  saving,
  acpOnly,
  testingPolishModel,
  polishModelTestResult,
  onClose,
  onNameChange,
  onProviderTypeChange,
  onModelChange,
  onPolishModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onDefaultChange,
  onTestPolishModel,
  onSave,
}: {
  form: ProviderFormState;
  error: string;
  saving: boolean;
  acpOnly?: boolean;
  testingPolishModel?: boolean;
  polishModelTestResult?: { status: 'success' | 'error'; message: string } | null;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onProviderTypeChange: (value: LlmProviderType) => void;
  onModelChange: (value: string) => void;
  onPolishModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onDefaultChange: (value: boolean) => void;
  onTestPolishModel: () => void;
  onSave: () => void;
}) {
  const isAcp = isAcpProvider(form.providerType);
  return (
    <SettingsModalShell
      title={form.id ? '编辑模型提供商' : acpOnly ? '添加 ACP 提供商' : '添加自定义提供商'}
      description={acpOnly ? '通过本地 CLI 调用模型，无需 API Key' : '提示词工坊会直接读取这里的配置'}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="提供商名称">
          <input
            type="text"
            value={form.name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={acpOnly ? '例如：Claude Code ACP' : '例如：DeepSeek Production'}
            className={inputCls}
          />
        </Field>

        <Field label="类型">
          <select
            value={form.providerType}
            onChange={(event) => onProviderTypeChange(event.target.value as LlmProviderType)}
            className={inputCls}
          >
            {acpOnly ? (
              <>
                <option value="claude_code_acp">Claude Code (ACP)</option>
                <option value="codex_acp">Codex CLI (ACP)</option>
              </>
            ) : (
              <>
                <option value="openai_compatible">OpenAI 兼容（DeepSeek、千问、豆包等）</option>
                <option value="anthropic">Anthropic</option>
              </>
            )}
          </select>
        </Field>

        <Field label="模型名称" hint={isAcp ? '例如 claude-sonnet-4-5、codex-mini-latest' : '例如 deepseek-chat、qwen-max、gpt-4.1'}>
          <input
            type="text"
            value={form.model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="输入模型标识"
            className={inputCls}
          />
        </Field>

        {!isAcp && (
          <Field label="Base URL" hint={`留空时默认使用 ${defaultBaseUrl(form.providerType)}`}>
            <input
              type="text"
              value={form.baseUrl}
              onChange={(event) => onBaseUrlChange(event.target.value)}
              placeholder={defaultBaseUrl(form.providerType)}
              className={inputCls}
            />
          </Field>
        )}

        {!isAcp && (
          <Field
            label="API Key"
            required={!form.id || !form.hasApiKey}
            hint={form.id && form.hasApiKey ? '已保存 API Key；留空则保留当前值' : undefined}
          >
            <input
              type="password"
              value={form.apiKey}
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={form.id && form.hasApiKey ? '留空则保留当前值' : 'sk-...'}
              className={inputCls}
            />
          </Field>
        )}

        {isAcp && (
          <div className="rounded-xl bg-violet-50 dark:bg-violet-900/10 border border-violet-200 dark:border-violet-900/30 px-4 py-3">
            <p className="text-xs text-violet-700 dark:text-violet-400 leading-relaxed">
              ACP 提供商通过本地 CLI 工具调用，无需配置 API Key。请确保对应 CLI 工具已安装并完成登录。
            </p>
          </div>
        )}

        {isAcp && (
          <Field label="润色文本模型" hint="留空则使用上方的主模型；填写后润色功能将使用此模型">
            <div className="flex gap-2">
              <input
                type="text"
                value={form.polishModel}
                onChange={(event) => onPolishModelChange(event.target.value)}
                placeholder="留空使用主模型，例如 claude-haiku-4-5-20251001"
                className={`${inputCls} flex-1`}
              />
              <button
                type="button"
                onClick={onTestPolishModel}
                disabled={testingPolishModel || saving}
                className={`${btnSecondary} shrink-0 flex items-center gap-1.5`}
              >
                {testingPolishModel && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                测试
              </button>
            </div>
            {polishModelTestResult && (
              <p className={`mt-1.5 text-xs ${polishModelTestResult.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {polishModelTestResult.message}
              </p>
            )}
          </Field>
        )}

        <label className="flex items-center gap-2.5 cursor-default">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(event) => onDefaultChange(event.target.checked)}
            className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
          />
          <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
            设为默认提供商
          </span>
        </label>

        {error && <ErrorMsg msg={error} />}

        <div className="pt-5 flex items-center justify-end gap-3 border-t border-stone-100 dark:border-stone-800">
          <button onClick={onClose} className={btnSecondary}>
            取消
          </button>
          <button onClick={onSave} disabled={saving} className={btnPrimary}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </SettingsModalShell>
  );
}
