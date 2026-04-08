import { useState, useEffect, useCallback, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import {
  Check,
  Cpu,
  Database,
  Edit2,
  Github,
  Gitlab,
  Link2,
  Loader2,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { useAppStore } from '../store';
import {
  getActiveProjectId,
  getConfig,
  getGitHubAccounts,
  getLlmProviders,
  getProjects,
  createGitHubAccount,
  updateGitHubAccount,
  deleteGitHubAccount as deleteGitHubAccountApi,
  createLlmProvider,
  updateLlmProvider,
  deleteLlmProvider as deleteLlmProviderApi,
  setConfig,
  testGitHubConnection,
  testGitLabConnection,
  type GitHubAccountConfig,
  type ProjectConfig,
} from '../services/config';
import { testLlmProvider, type LlmProviderConfig, type LlmProviderType } from '../services/llm';

const TABS = [
  { id: 'gitlab', label: 'GitLab', icon: Gitlab },
  { id: 'github', label: 'GitHub', icon: Github },
  { id: 'llm', label: '大语言模型', icon: Cpu },
  { id: 'general', label: '通用设置', icon: SettingsIcon },
  { id: 'data', label: '数据管理', icon: Database },
];

const inputCls = 'w-full bg-stone-50 dark:bg-[#171B22] border border-stone-200 dark:border-[#232834] rounded-2xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400/30 transition-shadow placeholder:text-stone-400';
const btnPrimary = 'px-5 py-2.5 bg-[#111827] hover:bg-[#1F2937] dark:bg-[#E5EAF2] dark:hover:bg-[#F3F6FB] text-white dark:text-[#0D1117] rounded-full text-sm font-semibold transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2 cursor-default';
const btnSecondary = 'px-5 py-2.5 bg-stone-100 dark:bg-stone-800 hover:bg-stone-200 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-sm font-semibold transition-colors flex items-center gap-2 cursor-default';

type ProviderFormState = {
  id: string | null;
  name: string;
  providerType: LlmProviderType;
  model: string;
  baseUrl: string;
  apiKey: string;
  isDefault: boolean;
};

type ProviderTestResult = {
  status: 'success' | 'error';
  message: string;
};

const EMPTY_PROVIDER_FORM: ProviderFormState = {
  id: null,
  name: '',
  providerType: 'openai_compatible',
  model: '',
  baseUrl: '',
  apiKey: '',
  isDefault: false,
};

type GitHubAccountFormState = {
  id: string | null;
  name: string;
  username: string;
  token: string;
  isDefault: boolean;
};

const EMPTY_GITHUB_FORM: GitHubAccountFormState = {
  id: null,
  name: '',
  username: '',
  token: '',
  isDefault: false,
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState('gitlab');
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [gitlabUrl, setGitlabUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabUsername, setGitlabUsername] = useState('');
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [activeProjectId, setActiveProjectIdState] = useState('');
  const [githubAccounts, setGithubAccounts] = useState<GitHubAccountConfig[]>([]);
  const [llmProviders, setLlmProviders] = useState<LlmProviderConfig[]>([]);

  const [loading, setLoading] = useState(true);
  const [savingGitlab, setSavingGitlab] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [gitlabSaveStatus, setGitlabSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [githubSaveStatus, setGithubSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [llmSaveStatus, setLlmSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [testingGithubAccountId, setTestingGithubAccountId] = useState('');
  const [githubConnectionStatus, setGithubConnectionStatus] = useState<Record<string, 'success' | 'error'>>({});
  const [testingProviderId, setTestingProviderId] = useState('');
  const [providerTestStatus, setProviderTestStatus] = useState<Record<string, ProviderTestResult>>({});
  const [gitlabError, setGitlabError] = useState('');
  const [gitlabLoadError, setGitlabLoadError] = useState('');
  const [projectLoadError, setProjectLoadError] = useState('');
  const [githubLoadError, setGithubLoadError] = useState('');
  const [llmLoadError, setLlmLoadError] = useState('');

  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubForm, setGithubForm] = useState<GitHubAccountFormState>(EMPTY_GITHUB_FORM);
  const [githubError, setGithubError] = useState('');
  const [savingGithubAccount, setSavingGithubAccount] = useState(false);

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM);
  const [providerError, setProviderError] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadGitLabSettings = async () => {
      try {
        const [url, token, username] = await Promise.all([
          getConfig('gitlab_url'),
          getConfig('gitlab_token'),
          getConfig('gitlab_username'),
        ]);
        if (cancelled) return;

        setGitlabUrl(url ?? '');
        setGitlabToken(token ?? '');
        setGitlabUsername(username ?? '');
        setGitlabLoadError('');
      } catch (error) {
        if (cancelled) return;
        setGitlabLoadError(formatErrorMessage(error, 'GitLab 配置加载失败'));
      }
    };

    const loadProjectSettings = async () => {
      try {
        const [projectList, activeProject] = await Promise.all([
          getProjects(),
          getActiveProjectId(),
        ]);
        if (cancelled) return;

        setProjects(projectList ?? []);
        setActiveProjectIdState(activeProject ?? '');
        setProjectLoadError('');
      } catch (error) {
        if (cancelled) return;
        setProjectLoadError(formatErrorMessage(error, '项目配置加载失败'));
      }
    };

    const loadGitHubSettings = async () => {
      try {
        const accounts = await getGitHubAccounts();
        if (cancelled) return;

        setGithubAccounts(normalizeGitHubAccounts(accounts ?? []));
        setGithubLoadError('');
      } catch (error) {
        if (cancelled) return;
        setGithubLoadError(formatErrorMessage(error, 'GitHub 账号加载失败'));
      }
    };

    const loadLLMSettings = async () => {
      try {
        const providers = await getLlmProviders();
        if (cancelled) return;

        setLlmProviders(normalizeProviders(providers ?? []));
        setLlmLoadError('');
      } catch (error) {
        if (cancelled) return;
        setLlmLoadError(formatErrorMessage(error, '模型配置加载失败'));
      }
    };

    Promise.allSettled([
      loadGitLabSettings(),
      loadProjectSettings(),
      loadGitHubSettings(),
      loadLLMSettings(),
    ]).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;
  const defaultGithubAccount = githubAccounts.find((account) => account.isDefault) ?? githubAccounts[0] ?? null;
  const isGitLabConfigured = Boolean(gitlabUrl.trim()) && Boolean(gitlabToken.trim());

  const handleSaveGitlab = useCallback(async () => {
    const validationError = validateGitLabSettings(gitlabUrl, gitlabToken);
    if (validationError) {
      setGitlabError(validationError);
      flashStatus(setGitlabSaveStatus, 'error', 3000);
      return;
    }

    setSavingGitlab(true);
    setGitlabError('');
    try {
      await Promise.all([
        setConfig('gitlab_url', gitlabUrl.trim()),
        setConfig('gitlab_token', gitlabToken.trim()),
        setConfig('gitlab_username', gitlabUsername.trim()),
      ]);
      flashStatus(setGitlabSaveStatus, 'saved');
    } catch (error) {
      setGitlabError(formatErrorMessage(error, '保存 GitLab 配置失败'));
      flashStatus(setGitlabSaveStatus, 'error', 3000);
    } finally {
      setSavingGitlab(false);
    }
  }, [gitlabUrl, gitlabToken, gitlabUsername]);

  const handleTestConnection = useCallback(async () => {
    const validationError = validateGitLabSettings(gitlabUrl, gitlabToken);
    if (validationError) {
      setGitlabError(validationError);
      setConnectionStatus('error');
      return;
    }

    setTestingConnection(true);
    setConnectionStatus('idle');
    setGitlabError('');
    try {
      const ok = await testGitLabConnection(gitlabUrl.trim(), gitlabToken.trim());
      setConnectionStatus(ok ? 'success' : 'error');
    } catch (error) {
      console.error('GitLab test failed:', error);
      setGitlabError(formatErrorMessage(error, 'GitLab 连接失败'));
      setConnectionStatus('error');
    } finally {
      setTestingConnection(false);
    }
  }, [gitlabUrl, gitlabToken]);

  const openCreateGithubModal = () => {
    setGithubForm({
      ...EMPTY_GITHUB_FORM,
      isDefault: githubAccounts.length === 0,
    });
    setGithubError('');
    setShowGithubModal(true);
  };

  const openEditGithubModal = (account: GitHubAccountConfig) => {
    setGithubForm({
      id: account.id,
      name: account.name,
      username: account.username,
      token: account.token,
      isDefault: account.isDefault,
    });
    setGithubError('');
    setShowGithubModal(true);
  };

  const closeGithubModal = () => {
    if (savingGithubAccount) return;
    setShowGithubModal(false);
    setGithubForm(EMPTY_GITHUB_FORM);
    setGithubError('');
  };

  const reloadGithubAccounts = async () => {
    const accounts = await getGitHubAccounts();
    setGithubAccounts(normalizeGitHubAccounts(accounts));
    flashStatus(setGithubSaveStatus, 'saved');
  };

  const handleSaveGithubAccount = async () => {
    const name = githubForm.name.trim();
    const username = githubForm.username.trim();
    const token = githubForm.token.trim();

    if (!name) {
      setGithubError('账号名称不能为空');
      return;
    }
    if (!username) {
      setGithubError('GitHub 用户名不能为空');
      return;
    }
    if (!token) {
      setGithubError('访问令牌不能为空');
      return;
    }

    setSavingGithubAccount(true);
    setGithubError('');

    try {
      const now = Math.floor(Date.now() / 1000);
      const nextAccount: GitHubAccountConfig = {
        id: githubForm.id ?? `github-${Date.now()}`,
        name,
        username,
        token,
        isDefault: githubForm.isDefault,
        createdAt: now,
        updatedAt: now,
      };

      if (githubForm.id) {
        // If setting as default, unset others first
        if (nextAccount.isDefault) {
          for (const account of githubAccounts) {
            if (account.id !== nextAccount.id && account.isDefault) {
              await updateGitHubAccount({ ...account, isDefault: false });
            }
          }
        }
        await updateGitHubAccount(nextAccount);
      } else {
        // If setting as default, unset others first
        if (nextAccount.isDefault) {
          for (const account of githubAccounts) {
            if (account.isDefault) {
              await updateGitHubAccount({ ...account, isDefault: false });
            }
          }
        }
        await createGitHubAccount(nextAccount);
      }

      await reloadGithubAccounts();
      closeGithubModal();
    } catch (error) {
      console.error(error);
      setGithubError(error instanceof Error ? error.message : '保存 GitHub 账号失败');
    } finally {
      setSavingGithubAccount(false);
    }
  };

  const handleDeleteGithubAccount = async (accountId: string) => {
    try {
      await deleteGitHubAccountApi(accountId);
      await reloadGithubAccounts();
    } catch (error) {
      console.error(error);
      flashStatus(setGithubSaveStatus, 'error', 3000);
    }
  };

  const handleSetDefaultGithubAccount = async (accountId: string) => {
    try {
      for (const account of githubAccounts) {
        if (account.id === accountId && !account.isDefault) {
          await updateGitHubAccount({ ...account, isDefault: true });
        } else if (account.id !== accountId && account.isDefault) {
          await updateGitHubAccount({ ...account, isDefault: false });
        }
      }
      await reloadGithubAccounts();
    } catch (error) {
      console.error(error);
      flashStatus(setGithubSaveStatus, 'error', 3000);
    }
  };

  const handleTestGithubAccount = async (account: GitHubAccountConfig) => {
    setTestingGithubAccountId(account.id);
    try {
      const ok = await testGitHubConnection(account.username, account.token);
      setGithubConnectionStatus((current) => ({
        ...current,
        [account.id]: ok ? 'success' : 'error',
      }));
    } catch (error) {
      console.error('GitHub test failed:', error);
      setGithubConnectionStatus((current) => ({
        ...current,
        [account.id]: 'error',
      }));
    } finally {
      setTestingGithubAccountId('');
    }
  };

  const openCreateProviderModal = () => {
    setProviderForm({
      ...EMPTY_PROVIDER_FORM,
      isDefault: llmProviders.length === 0,
    });
    setProviderError('');
    setShowProviderModal(true);
  };

  const openEditProviderModal = (provider: LlmProviderConfig) => {
    setProviderForm({
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      model: provider.model,
      baseUrl: provider.baseUrl ?? '',
      apiKey: provider.apiKey,
      isDefault: provider.isDefault,
    });
    setProviderError('');
    setShowProviderModal(true);
  };

  const closeProviderModal = () => {
    if (savingProvider) return;
    setShowProviderModal(false);
    setProviderForm(EMPTY_PROVIDER_FORM);
    setProviderError('');
  };

  const reloadLlmProviders = async () => {
    const providers = await getLlmProviders();
    setLlmProviders(normalizeProviders(providers));
    flashStatus(setLlmSaveStatus, 'saved');
  };

  const handleSaveProvider = async () => {
    const name = providerForm.name.trim();
    const model = providerForm.model.trim();
    const apiKey = providerForm.apiKey.trim();
    const baseUrl = providerForm.baseUrl.trim();

    if (!name) {
      setProviderError('提供商名称不能为空');
      return;
    }
    if (!model) {
      setProviderError('模型名称不能为空');
      return;
    }
    if (!apiKey) {
      setProviderError('API Key 不能为空');
      return;
    }

    setSavingProvider(true);
    setProviderError('');

    try {
      const nextProvider: LlmProviderConfig = {
        id: providerForm.id ?? `llm-${Date.now()}`,
        name,
        providerType: providerForm.providerType,
        model,
        baseUrl: baseUrl || null,
        apiKey,
        isDefault: providerForm.isDefault,
      };

      if (providerForm.id) {
        if (nextProvider.isDefault) {
          for (const provider of llmProviders) {
            if (provider.id !== nextProvider.id && provider.isDefault) {
              await updateLlmProvider({ ...provider, isDefault: false });
            }
          }
        }
        await updateLlmProvider(nextProvider);
      } else {
        if (nextProvider.isDefault) {
          for (const provider of llmProviders) {
            if (provider.isDefault) {
              await updateLlmProvider({ ...provider, isDefault: false });
            }
          }
        }
        await createLlmProvider(nextProvider);
      }

      await reloadLlmProviders();
      closeProviderModal();
    } catch (error) {
      console.error(error);
      setProviderError(error instanceof Error ? error.message : '保存模型配置失败');
    } finally {
      setSavingProvider(false);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await deleteLlmProviderApi(providerId);
      await reloadLlmProviders();
    } catch (error) {
      console.error(error);
      flashStatus(setLlmSaveStatus, 'error', 3000);
    }
  };

  const handleSetDefaultProvider = async (providerId: string) => {
    try {
      for (const provider of llmProviders) {
        if (provider.id === providerId && !provider.isDefault) {
          await updateLlmProvider({ ...provider, isDefault: true });
        } else if (provider.id !== providerId && provider.isDefault) {
          await updateLlmProvider({ ...provider, isDefault: false });
        }
      }
      await reloadLlmProviders();
    } catch (error) {
      console.error(error);
      flashStatus(setLlmSaveStatus, 'error', 3000);
    }
  };

  const handleTestProvider = async (provider: LlmProviderConfig) => {
    setTestingProviderId(provider.id);
    try {
      const ok = await testLlmProvider(provider);
      setProviderTestStatus((current) => ({
        ...current,
        [provider.id]: {
          status: ok ? 'success' : 'error',
          message: ok ? '连接成功，可用于生成提示词' : '连接失败',
        },
      }));
    } catch (error) {
      console.error('LLM provider test failed:', error);
      setProviderTestStatus((current) => ({
        ...current,
        [provider.id]: {
          status: 'error',
          message: formatErrorMessage(error, '连接失败'),
        },
      }));
    } finally {
      setTestingProviderId('');
    }
  };

  return (
    <div className="h-full flex flex-col p-8 bg-stone-50 dark:bg-[#161615]">
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-50 tracking-tight">设置</h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">管理账号、模型和通用配置</p>
      </div>

      <div className="flex-1 flex gap-6 min-h-0">
        <nav className="w-44 flex-shrink-0 flex flex-col gap-0.5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-2xl text-[13px] font-medium transition-all text-left cursor-default ${
                activeTab === tab.id
                  ? 'bg-[#E7EDF5] dark:bg-[#1A1F29] text-[#111827] dark:text-[#F8FBFF] shadow-sm shadow-black/[.05]'
                  : 'text-stone-500 dark:text-stone-400 hover:bg-white/70 dark:hover:bg-stone-800/50 hover:text-stone-800 dark:hover:text-stone-200'
              }`}
            >
              <tab.icon
                className={`w-4 h-4 flex-shrink-0 ${
                  activeTab === tab.id ? 'text-[#64748B] dark:text-[#CBD5E1]' : 'text-stone-400'
                }`}
              />
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 rounded-3xl overflow-y-auto">
          <div className="p-8">
            {activeTab === 'gitlab' && (
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
                        onChange={(e) => {
                          setGitlabUrl(e.target.value);
                          setGitlabError('');
                          setConnectionStatus('idle');
                        }}
                        placeholder="https://gitlab.example.com"
                        required
                        className={inputCls}
                      />
                    </Field>
                    <Field label="个人访问令牌 (PAT)" required>
                      <input
                        type="password"
                        value={gitlabToken}
                        onChange={(e) => {
                          setGitlabToken(e.target.value);
                          setGitlabError('');
                          setConnectionStatus('idle');
                        }}
                        placeholder="glpat-xxxxxxxxxxxx"
                        required
                        className={inputCls}
                      />
                    </Field>
                    <Field label="用户名" hint="可选；留空时默认使用 oauth2 进行 Clone">
                      <input
                        type="text"
                        value={gitlabUsername}
                        onChange={(e) => {
                          setGitlabUsername(e.target.value);
                          setGitlabError('');
                        }}
                        placeholder="your-username"
                        className={inputCls}
                      />
                    </Field>

                    {gitlabError && <ErrorMsg msg={gitlabError} />}

                    <div className="pt-5 flex items-center justify-between border-t border-stone-100 dark:border-stone-800">
                      <div className="flex items-center gap-3">
                        <button onClick={handleTestConnection} disabled={testingConnection || !isGitLabConfigured} className={btnSecondary}>
                          {testingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                          测试连接
                        </button>
                        {connectionStatus === 'success' && <StatusBadge ok>已连接</StatusBadge>}
                        {connectionStatus === 'error' && <StatusBadge>连接失败</StatusBadge>}
                      </div>
                      <div className="flex items-center gap-3">
                        {gitlabSaveStatus === 'saved' && <StatusBadge ok>已保存</StatusBadge>}
                        {gitlabSaveStatus === 'error' && <StatusBadge>保存失败</StatusBadge>}
                        <button onClick={handleSaveGitlab} disabled={savingGitlab || !isGitLabConfigured} className={btnPrimary}>
                          {savingGitlab && <Loader2 className="w-4 h-4 animate-spin" />}
                          保存
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'github' && (
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
                      <button onClick={openCreateGithubModal} className={btnPrimary}>
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
                                <p>访问令牌: {maskSecret(account.token)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {!account.isDefault && (
                                <button
                                  onClick={() => handleSetDefaultGithubAccount(account.id)}
                                  className={btnSecondary}
                                >
                                  <ShieldCheck className="w-4 h-4" />
                                  设为默认
                                </button>
                              )}
                              <button
                                onClick={() => handleTestGithubAccount(account)}
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
                              <IconBtn title="编辑" onClick={() => openEditGithubModal(account)}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </IconBtn>
                              <IconBtn title="删除" danger onClick={() => handleDeleteGithubAccount(account.id)}>
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
            )}

            {activeTab === 'llm' && (
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
                      <button onClick={openCreateProviderModal} className={btnPrimary}>
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
                                <p>Base URL: {provider.baseUrl?.trim() || defaultBaseUrl(provider.providerType)}</p>
                                <p>API Key: {maskSecret(provider.apiKey)}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              {!provider.isDefault && (
                                <button
                                  onClick={() => handleSetDefaultProvider(provider.id)}
                                  className={btnSecondary}
                                >
                                  <ShieldCheck className="w-4 h-4" />
                                  设为默认
                                </button>
                              )}
                              <button
                                onClick={() => handleTestProvider(provider)}
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
                              <IconBtn title="编辑" onClick={() => openEditProviderModal(provider)}>
                                <Edit2 className="w-3.5 h-3.5" />
                              </IconBtn>
                              <IconBtn title="删除" danger onClick={() => handleDeleteProvider(provider.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </IconBtn>
                            </div>
                          </div>

                          {providerTestStatus[provider.id] && (
                            <div className="mt-4 pt-4 border-t border-stone-200 dark:border-stone-700">
                              {providerTestStatus[provider.id]?.status === 'success' ? (
                                <StatusBadge ok>{providerTestStatus[provider.id]?.message}</StatusBadge>
                              ) : (
                                <ErrorMsg msg={providerTestStatus[provider.id]?.message || '连接失败'} />
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'general' && (
              <section className="max-w-lg animate-in fade-in duration-150">
                <SectionHead title="通用设置" description="主题配置会立即生效；项目请在侧边栏顶部切换，在左下角入口新建" />

                {loading ? (
                  <Spinner />
                ) : (
                  <div className="space-y-6">
                    {projectLoadError && <ErrorMsg msg={projectLoadError} />}

                    <Field label="主题">
                      <div className="flex gap-5">
                        {(['light', 'dark'] as const).map((t) => (
                          <label key={t} className="flex items-center gap-2.5 cursor-default">
                            <input
                              type="radio"
                              name="theme"
                              checked={theme === t}
                              onChange={() => setTheme(t)}
                              className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                            />
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                              {t === 'light' ? '浅色' : '深色'}
                            </span>
                          </label>
                        ))}
                      </div>
                    </Field>
                    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-3 text-sm text-stone-500 dark:text-stone-400">
                      当前项目可在侧边栏顶部直接切换；项目名称、项目目录、模型列表、源码模型和源码仓库请使用左下角“新建项目”入口或看板内的项目配置抽屉管理。
                    </div>
                    <div className="rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700 px-4 py-4 space-y-2">
                      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">提交流程默认值</p>
                      <InfoText label="当前项目">{activeProject?.name || '未设置'}</InfoText>
                      <InfoText label="源码模型">{activeProject?.sourceModelFolder || 'ORIGIN'}</InfoText>
                      <InfoText label="源码仓库">{activeProject?.defaultSubmitRepo || '自动生成'}</InfoText>
                      <InfoText label="默认 GitHub 账号">
                        {defaultGithubAccount ? `${defaultGithubAccount.name} · @${defaultGithubAccount.username}` : '未设置'}
                      </InfoText>
                      <InfoText label="默认 PR 标题">当前模型名称</InfoText>
                      <InfoText label="默认 PR 说明">空</InfoText>
                    </div>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'data' && (
              <section className="max-w-lg animate-in fade-in duration-150">
                <SectionHead title="数据管理" description="这部分尚未开放，先明确标记为规划中，避免误触后无反馈" />
                <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/10 dark:text-amber-300">
                  数据导入、导出和批量清理尚未接入真实逻辑。这里保留规划说明，但相关操作暂时不可点击。
                </div>
                <div className="space-y-3">
                  {[
                    { title: '导出数据', desc: '将所有任务和配置导出为 JSON（规划中）', btn: '规划中' },
                    { title: '导入数据', desc: '从之前导出的 JSON 文件恢复（规划中）', btn: '规划中' },
                  ].map((item) => (
                    <div
                      key={item.title}
                      className="flex items-center justify-between p-4 rounded-2xl bg-stone-50 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700"
                    >
                      <div>
                        <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{item.title}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">{item.desc}</p>
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
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">清除已归档任务</p>
                      <p className="text-xs text-red-500/70 dark:text-red-400/60 mt-0.5">批量清理逻辑尚未接入，当前仅保留规划入口</p>
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
            )}
          </div>
        </div>
      </div>

      {showGithubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm" onClick={closeGithubModal} />
          <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">
                  {githubForm.id ? '编辑 GitHub 账号' : '添加 GitHub 账号'}
                </h2>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                  供提交中心读取默认账号身份、令牌和默认仓库
                </p>
              </div>
              <button onClick={closeGithubModal} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <p className="text-xs text-stone-400 dark:text-stone-500">带 * 的字段为必填项</p>

              <Field label="账号名称" required hint="例如：work-account / personal">
                <input
                  type="text"
                  value={githubForm.name}
                  onChange={(event) => setGithubForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：work-account"
                  required
                  className={inputCls}
                />
              </Field>

              <Field label="GitHub 用户名" required>
                <input
                  type="text"
                  value={githubForm.username}
                  onChange={(event) => setGithubForm((current) => ({ ...current, username: event.target.value }))}
                  placeholder="例如：blueship581"
                  required
                  className={inputCls}
                />
              </Field>

              <Field label="访问令牌" required>
                <input
                  type="password"
                  value={githubForm.token}
                  onChange={(event) => setGithubForm((current) => ({ ...current, token: event.target.value }))}
                  placeholder="ghp_..."
                  required
                  className={inputCls}
                />
              </Field>

              <label className="flex items-center gap-2.5 cursor-default">
                <input
                  type="checkbox"
                  checked={githubForm.isDefault}
                  onChange={(event) => setGithubForm((current) => ({ ...current, isDefault: event.target.checked }))}
                  className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                />
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">设为默认账号</span>
              </label>

              {githubError && <ErrorMsg msg={githubError} />}

              <div className="pt-5 flex items-center justify-end gap-3 border-t border-stone-100 dark:border-stone-800">
                <button onClick={closeGithubModal} className={btnSecondary}>
                  取消
                </button>
                <button
                  onClick={handleSaveGithubAccount}
                  disabled={savingGithubAccount || !githubForm.name.trim() || !githubForm.username.trim() || !githubForm.token.trim()}
                  className={btnPrimary}
                >
                  {savingGithubAccount && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProviderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/20 dark:bg-black/45 backdrop-blur-sm" onClick={closeProviderModal} />
          <div className="relative w-full max-w-lg rounded-3xl bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-800 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50">
                  {providerForm.id ? '编辑模型提供商' : '添加模型提供商'}
                </h2>
                <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
                  第二阶段提示词工坊会直接读取这里的配置
                </p>
              </div>
              <button onClick={closeProviderModal} className="p-2 rounded-xl hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-400">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <Field label="提供商名称">
                <input
                  type="text"
                  value={providerForm.name}
                  onChange={(event) => setProviderForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="例如：OpenAI Production"
                  className={inputCls}
                />
              </Field>

              <Field label="类型">
                <select
                  value={providerForm.providerType}
                  onChange={(event) =>
                    setProviderForm((current) => ({
                      ...current,
                      providerType: event.target.value as LlmProviderType,
                    }))
                  }
                  className={inputCls}
                >
                  <option value="openai_compatible">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Field>

              <Field label="模型名称" hint="例如 gpt-4.1、deepseek-chat、claude-3-7-sonnet-20250219">
                <input
                  type="text"
                  value={providerForm.model}
                  onChange={(event) => setProviderForm((current) => ({ ...current, model: event.target.value }))}
                  placeholder="输入模型标识"
                  className={inputCls}
                />
              </Field>

              <Field label="Base URL" hint={`留空时默认使用 ${defaultBaseUrl(providerForm.providerType)}`}>
                <input
                  type="text"
                  value={providerForm.baseUrl}
                  onChange={(event) => setProviderForm((current) => ({ ...current, baseUrl: event.target.value }))}
                  placeholder={defaultBaseUrl(providerForm.providerType)}
                  className={inputCls}
                />
              </Field>

              <Field label="API Key">
                <input
                  type="password"
                  value={providerForm.apiKey}
                  onChange={(event) => setProviderForm((current) => ({ ...current, apiKey: event.target.value }))}
                  placeholder="sk-..."
                  className={inputCls}
                />
              </Field>

              <label className="flex items-center gap-2.5 cursor-default">
                <input
                  type="checkbox"
                  checked={providerForm.isDefault}
                  onChange={(event) => setProviderForm((current) => ({ ...current, isDefault: event.target.checked }))}
                  className="w-4 h-4 text-slate-700 dark:text-slate-300 focus:ring-slate-400/30 cursor-default"
                />
                <span className="text-sm font-medium text-stone-700 dark:text-stone-300">设为默认提供商</span>
              </label>

              {providerError && <ErrorMsg msg={providerError} />}

              <div className="pt-5 flex items-center justify-end gap-3 border-t border-stone-100 dark:border-stone-800">
                <button onClick={closeProviderModal} className={btnSecondary}>
                  取消
                </button>
                <button onClick={handleSaveProvider} disabled={savingProvider} className={btnPrimary}>
                  {savingProvider && <Loader2 className="w-4 h-4 animate-spin" />}
                  保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-7">
      <h2 className="text-lg font-bold text-stone-900 dark:text-stone-50 tracking-tight">{title}</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">{description}</p>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-stone-700 dark:text-stone-300 mb-1.5">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-stone-400 dark:text-stone-500 mt-1.5">{hint}</p>}
    </div>
  );
}

function InfoText({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-stone-400 dark:text-stone-500 flex-shrink-0">{label}</span>
      <span className="text-right text-stone-700 dark:text-stone-300 break-all">{children}</span>
    </div>
  );
}

function StatusBadge({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span className={`text-sm font-semibold flex items-center gap-1.5 ${ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      {ok ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
      {children}
    </span>
  );
}

function MiniBadge({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
        ok
          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
          : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
      }`}
    >
      {children}
    </span>
  );
}

function IconBtn({
  title,
  danger,
  onClick,
  children,
}: {
  title: string;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-2 rounded-xl transition-colors cursor-default ${
        danger
          ? 'text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'
          : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
      }`}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
    </div>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return <p className="text-sm text-red-500 font-medium">{msg}</p>;
}

function EmptyState({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-stone-200 dark:border-stone-800 bg-stone-50/80 dark:bg-stone-900/50 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white dark:bg-stone-800 text-stone-400">
        {icon ?? <Cpu className="w-5 h-5" />}
      </div>
      <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">{title}</p>
      <p className="text-sm leading-6 text-stone-500 dark:text-stone-400 mt-1">{description}</p>
    </div>
  );
}

function defaultBaseUrl(providerType: LlmProviderType) {
  return providerType === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1';
}

function providerTypeLabel(providerType: LlmProviderType) {
  return providerType === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容';
}

function normalizeProviders(providers: LlmProviderConfig[]) {
  if (!providers.length) return [];

  const hasDefault = providers.some((provider) => provider.isDefault);
  return providers.map((provider, index) => ({
    ...provider,
    providerType: normalizeProviderType(provider.providerType),
    isDefault: hasDefault ? provider.isDefault : index === 0,
  }));
}

function normalizeProviderType(providerType: string | null | undefined): LlmProviderType {
  return providerType === 'anthropic' ? 'anthropic' : 'openai_compatible';
}

function normalizeGitHubAccounts(accounts: GitHubAccountConfig[]) {
  if (!accounts.length) return [];

  const hasDefault = accounts.some((account) => account.isDefault);
  return accounts.map((account, index) => ({
    ...account,
    isDefault: hasDefault ? account.isDefault : index === 0,
  }));
}

function validateGitLabSettings(url: string, token: string) {
  const trimmedURL = url.trim();
  const trimmedToken = token.trim();

  if (!trimmedURL) {
    return 'GitLab 服务器地址不能为空';
  }
  if (!/^https?:\/\//i.test(trimmedURL)) {
    return 'GitLab 服务器地址必须以 http:// 或 https:// 开头';
  }
  if (!trimmedToken) {
    return 'GitLab 访问令牌不能为空';
  }

  return '';
}

function formatErrorMessage(error: unknown, fallback: string) {
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

function maskSecret(value: string) {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 3)}***${value.slice(-4)}`;
}

function flashStatus(
  setter: Dispatch<SetStateAction<'idle' | 'saved' | 'error'>>,
  next: 'saved' | 'error',
  delay = 2000,
) {
  setter(next);
  setTimeout(() => setter('idle'), delay);
}
