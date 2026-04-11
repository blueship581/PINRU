import { type ReactNode } from 'react';
import {
  Edit2,
  Github,
  Link2,
  Loader2,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { GitHubAccountConfig, ProjectConfig } from '../../../api/config';
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
  gitlabError,
  testingConnection,
  connectionStatus,
  savingGitlab,
  gitlabSaveStatus,
  isGitLabConfigured,
  onGitlabUrlChange,
  onGitlabTokenChange,
  onGitlabUsernameChange,
  onTestConnection,
  onSave,
}: {
  loading: boolean;
  gitlabLoadError: string;
  gitlabUrl: string;
  gitlabToken: string;
  gitlabUsername: string;
  gitlabHasToken: boolean;
  gitlabError: string;
  testingConnection: boolean;
  connectionStatus: 'idle' | 'success' | 'error';
  savingGitlab: boolean;
  gitlabSaveStatus: 'idle' | 'saved' | 'error';
  isGitLabConfigured: boolean;
  onGitlabUrlChange: (value: string) => void;
  onGitlabTokenChange: (value: string) => void;
  onGitlabUsernameChange: (value: string) => void;
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

export function LlmProvidersPanel({
  llmLoadError,
  llmSaveStatus,
  llmProviders,
  testingProviderId,
  providerTestStatus,
  onCreateProvider,
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
  onSetDefaultProvider: (providerId: string) => void;
  onTestProvider: (provider: LlmProviderConfig) => void;
  onEditProvider: (provider: LlmProviderConfig) => void;
  onDeleteProvider: (providerId: string) => void;
}) {
  return (
    <section className="animate-in fade-in duration-150">
      <SectionHead
        title="大语言模型提供商"
        description="第二阶段的提示词工坊会直接读取这里的配置并调用对应接口"
      />

      <div className="max-w-3xl">
        {llmLoadError && (
          <div className="mb-5">
            <ErrorMsg msg={llmLoadError} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="text-sm text-stone-500 dark:text-stone-400">
            支持 OpenAI 兼容接口和 Anthropic。DeepSeek、OpenRouter、通义等兼容接口请选择 OpenAI 兼容。
          </div>
          <div className="flex items-center gap-3">
            {llmSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
            {llmSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
            <button onClick={onCreateProvider} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              添加提供商
            </button>
          </div>
        </div>

        {!llmProviders.length ? (
          <EmptyState
            title="还没有配置大语言模型"
            description="添加至少一个提供商后，提示词工坊才能在第二阶段生成真实提示词。"
          />
        ) : (
          <div className="space-y-3">
            {llmProviders.map((provider) => (
              <div
                key={provider.id}
                className="p-5 rounded-3xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">
                        {provider.name}
                      </span>
                      {provider.isDefault && <MiniBadge ok>默认</MiniBadge>}
                      <MiniBadge>{providerTypeLabel(provider.providerType)}</MiniBadge>
                    </div>
                    <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                      {provider.model}
                    </p>
                    <div className="mt-3 space-y-1 text-xs text-stone-500 dark:text-stone-400">
                      <p>
                        Base URL: {provider.baseUrl?.trim() || defaultBaseUrl(provider.providerType)}
                      </p>
                      <p>
                        API Key: {describeSecret(Boolean(provider.hasApiKey), provider.apiKey)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!provider.isDefault && (
                      <button
                        onClick={() => onSetDefaultProvider(provider.id)}
                        className={btnSecondary}
                      >
                        <ShieldCheck className="w-4 h-4" />
                        设为默认
                      </button>
                    )}
                    <button
                      onClick={() => onTestProvider(provider)}
                      disabled={testingProviderId === provider.id}
                      className={btnSecondary}
                    >
                      {testingProviderId === provider.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4" />
                      )}
                      测试
                    </button>
                    <IconBtn title="编辑" onClick={() => onEditProvider(provider)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </IconBtn>
                    <IconBtn
                      title="删除"
                      danger
                      onClick={() => onDeleteProvider(provider.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconBtn>
                  </div>
                </div>

                {providerTestStatus[provider.id] && (
                  <div className="mt-4 pt-4 border-t border-stone-200 dark:border-stone-700">
                    {providerTestStatus[provider.id]?.status === 'success' ? (
                      <StatusBadge ok>{providerTestStatus[provider.id]?.message}</StatusBadge>
                    ) : (
                      <ErrorMsg
                        msg={providerTestStatus[provider.id]?.message || '连接失败'}
                      />
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

export function GeneralSettingsPanel({
  loading,
  projectLoadError,
  theme,
  onThemeChange,
  activeProject,
  defaultGithubAccount,
}: {
  loading: boolean;
  projectLoadError: string;
  theme: 'light' | 'dark';
  onThemeChange: (theme: 'light' | 'dark') => void;
  activeProject: ProjectConfig | null;
  defaultGithubAccount: GitHubAccountConfig | null;
}) {
  return (
    <section className="max-w-lg animate-in fade-in duration-150">
      <SectionHead
        title="通用设置"
        description="主题配置会立即生效；项目请在侧边栏顶部切换，在左下角入口新建"
      />

      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          {projectLoadError && <ErrorMsg msg={projectLoadError} />}

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
          <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 text-sm text-stone-500 dark:text-stone-400">
            当前项目可在侧边栏顶部直接切换；项目名称、项目目录、模型列表、源码模型和源码仓库请使用左下角“新建项目”入口或看板内的项目配置抽屉管理。
          </div>
          <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4 space-y-2">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              提交流程默认值
            </p>
            <InfoText label="当前项目">{activeProject?.name || '未设置'}</InfoText>
            <InfoText label="源码模型">
              {activeProject?.sourceModelFolder || 'ORIGIN'}
            </InfoText>
            <InfoText label="源码仓库">
              {activeProject?.defaultSubmitRepo || '自动生成'}
            </InfoText>
            <InfoText label="默认 GitHub 账号">
              {defaultGithubAccount
                ? `${defaultGithubAccount.name} · @${defaultGithubAccount.username}`
                : '未设置'}
            </InfoText>
            <InfoText label="默认 PR 标题">当前模型名称</InfoText>
            <InfoText label="默认 PR 说明">空</InfoText>
          </div>
        </div>
      )}
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
  onClose,
  onNameChange,
  onProviderTypeChange,
  onModelChange,
  onBaseUrlChange,
  onApiKeyChange,
  onDefaultChange,
  onSave,
}: {
  form: ProviderFormState;
  error: string;
  saving: boolean;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onProviderTypeChange: (value: LlmProviderType) => void;
  onModelChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onDefaultChange: (value: boolean) => void;
  onSave: () => void;
}) {
  return (
    <SettingsModalShell
      title={form.id ? '编辑模型提供商' : '添加模型提供商'}
      description="第二阶段提示词工坊会直接读取这里的配置"
      onClose={onClose}
    >
      <div className="space-y-4">
        <Field label="提供商名称">
          <input
            type="text"
            value={form.name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="例如：OpenAI Production"
            className={inputCls}
          />
        </Field>

        <Field label="类型">
          <select
            value={form.providerType}
            onChange={(event) => onProviderTypeChange(event.target.value as LlmProviderType)}
            className={inputCls}
          >
            <option value="openai_compatible">OpenAI 兼容</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>

        <Field label="模型名称" hint="例如 gpt-4.1、deepseek-chat、claude-3-7-sonnet-20250219">
          <input
            type="text"
            value={form.model}
            onChange={(event) => onModelChange(event.target.value)}
            placeholder="输入模型标识"
            className={inputCls}
          />
        </Field>

        <Field label="Base URL" hint={`留空时默认使用 ${defaultBaseUrl(form.providerType)}`}>
          <input
            type="text"
            value={form.baseUrl}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            placeholder={defaultBaseUrl(form.providerType)}
            className={inputCls}
          />
        </Field>

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
