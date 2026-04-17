import { useState, useEffect, useCallback } from 'react';
import {
  Cpu,
  Database,
  Github,
  Gitlab,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useAppStore } from '../../store';
import {
  getGitHubAccounts,
  getGitLabSettings,
  getLlmProviders,
  createGitHubAccount,
  updateGitHubAccount,
  deleteGitHubAccount as deleteGitHubAccountApi,
  createLlmProvider,
  updateLlmProvider,
  deleteLlmProvider as deleteLlmProviderApi,
  saveGitLabSettings,
  testGitHubAccountConnection,
  testGitLabConnection,
  getTraeSettings,
  saveTraeSettings,
  type GitHubAccountConfig,
} from '../../api/config';
import { testLlmProvider, type LlmProviderConfig } from '../../api/llm';
import {
  flashStatus,
  isAcpProvider,
  normalizeGitHubAccounts,
  normalizeProviders,
  validateGitLabSettings,
} from './utils/settingsUtils';
import { toErrorMessage as formatErrorMessage } from '../../shared/lib/errorMessage';
import {
  DataManagementPanel,
  EMPTY_GITHUB_FORM,
  EMPTY_PROVIDER_FORM,
  GeneralSettingsPanel,
  GitHubAccountModal,
  GitHubAccountsPanel,
  GitLabSettingsPanel,
  LlmProvidersPanel,
  ProviderModal,
  type GitHubAccountFormState,
  type ProviderFormState,
  type ProviderTestResult,
} from './components/SettingsPanels';

const TABS = [
  { id: 'gitlab', label: 'GitLab', icon: Gitlab },
  { id: 'github', label: 'GitHub', icon: Github },
  { id: 'llm', label: '大语言模型', icon: Cpu },
  { id: 'general', label: '通用设置', icon: SettingsIcon },
  { id: 'data', label: '数据管理', icon: Database },
];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('gitlab');
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [gitlabUrl, setGitlabUrl] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [gitlabUsername, setGitlabUsername] = useState('');
  const [gitlabHasToken, setGitlabHasToken] = useState(false);
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
  const [githubLoadError, setGithubLoadError] = useState('');
  const [llmLoadError, setLlmLoadError] = useState('');

  const [traeWorkspaceStoragePath, setTraeWorkspaceStoragePath] = useState('');
  const [traeLogsPath, setTraeLogsPath] = useState('');
  const [traeDefaultWorkspaceStoragePath, setTraeDefaultWorkspaceStoragePath] = useState('');
  const [traeDefaultLogsPath, setTraeDefaultLogsPath] = useState('');
  const [traePathSaveStatus, setTraePathSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubForm, setGithubForm] = useState<GitHubAccountFormState>(EMPTY_GITHUB_FORM);
  const [githubError, setGithubError] = useState('');
  const [savingGithubAccount, setSavingGithubAccount] = useState(false);

  const [showProviderModal, setShowProviderModal] = useState(false);
  const [providerModalAcpOnly, setProviderModalAcpOnly] = useState(false);
  const [providerForm, setProviderForm] = useState<ProviderFormState>(EMPTY_PROVIDER_FORM);
  const [providerError, setProviderError] = useState('');
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingPolishModel, setTestingPolishModel] = useState(false);
  const [polishModelTestResult, setPolishModelTestResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadGitLabSettings = async () => {
      try {
        const settings = await getGitLabSettings();
        if (cancelled) return;

        setGitlabUrl(settings.url ?? '');
        setGitlabToken('');
        setGitlabUsername(settings.username ?? '');
        setGitlabHasToken(settings.hasToken);
        setGitlabLoadError('');
      } catch (error) {
        if (cancelled) return;
        setGitlabLoadError(formatErrorMessage(error, 'GitLab 配置加载失败'));
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

    const loadTraeSettings = async () => {
      try {
        const settings = await getTraeSettings();
        if (cancelled) return;
        setTraeWorkspaceStoragePath(settings.workspaceStoragePath ?? '');
        setTraeLogsPath(settings.logsPath ?? '');
        setTraeDefaultWorkspaceStoragePath(settings.defaultWorkspaceStoragePath ?? '');
        setTraeDefaultLogsPath(settings.defaultLogsPath ?? '');
      } catch {
        // non-critical; silently ignore
      }
    };

    Promise.allSettled([
      loadGitLabSettings(),
      loadGitHubSettings(),
      loadLLMSettings(),
      loadTraeSettings(),
    ]).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const isGitLabConfigured = Boolean(gitlabUrl.trim()) && (Boolean(gitlabToken.trim()) || gitlabHasToken);

  const handleSaveGitlab = useCallback(async () => {
    const validationError = validateGitLabSettings(gitlabUrl, gitlabToken, gitlabHasToken);
    if (validationError) {
      setGitlabError(validationError);
      flashStatus(setGitlabSaveStatus, 'error', 3000);
      return;
    }

    setSavingGitlab(true);
    setGitlabError('');
    try {
      await saveGitLabSettings(gitlabUrl.trim(), gitlabUsername.trim(), gitlabToken.trim());
      setGitlabHasToken(gitlabHasToken || gitlabToken.trim().length > 0);
      setGitlabToken('');
      flashStatus(setGitlabSaveStatus, 'saved');
    } catch (error) {
      setGitlabError(formatErrorMessage(error, '保存 GitLab 配置失败'));
      flashStatus(setGitlabSaveStatus, 'error', 3000);
    } finally {
      setSavingGitlab(false);
    }
  }, [gitlabHasToken, gitlabUrl, gitlabToken, gitlabUsername]);

  const handleTestConnection = useCallback(async () => {
    const validationError = validateGitLabSettings(gitlabUrl, gitlabToken, gitlabHasToken);
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
  }, [gitlabHasToken, gitlabUrl, gitlabToken]);

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
      token: '',
      hasToken: account.hasToken,
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
    if (!token && !(githubForm.id && githubForm.hasToken)) {
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
        hasToken: githubForm.hasToken || token.length > 0,
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
      const ok = await testGitHubAccountConnection(account.id, account.username, account.token);
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
    setProviderModalAcpOnly(false);
    setProviderError('');
    setPolishModelTestResult(null);
    setShowProviderModal(true);
  };

  const openCreateAcpProviderModal = () => {
    setProviderForm({
      ...EMPTY_PROVIDER_FORM,
      providerType: 'claude_code_acp',
      isDefault: llmProviders.length === 0,
    });
    setProviderModalAcpOnly(true);
    setProviderError('');
    setPolishModelTestResult(null);
    setShowProviderModal(true);
  };

  const openEditProviderModal = (provider: LlmProviderConfig) => {
    setProviderForm({
      id: provider.id,
      name: provider.name,
      providerType: provider.providerType,
      model: provider.model,
      polishModel: provider.polishModel ?? '',
      baseUrl: provider.baseUrl ?? '',
      apiKey: '',
      hasApiKey: Boolean(provider.hasApiKey),
      isDefault: provider.isDefault,
    });
    setProviderModalAcpOnly(isAcpProvider(provider.providerType));
    setProviderError('');
    setPolishModelTestResult(null);
    setShowProviderModal(true);
  };

  const closeProviderModal = () => {
    if (savingProvider) return;
    setShowProviderModal(false);
    setProviderModalAcpOnly(false);
    setProviderForm(EMPTY_PROVIDER_FORM);
    setProviderError('');
    setPolishModelTestResult(null);
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
    const isAcp = isAcpProvider(providerForm.providerType);

    if (!name) {
      setProviderError('提供商名称不能为空');
      return;
    }
    if (!model) {
      setProviderError('模型名称不能为空');
      return;
    }
    if (!isAcp && !apiKey && !(providerForm.id && providerForm.hasApiKey)) {
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
        polishModel: providerForm.polishModel.trim(),
        baseUrl: baseUrl || null,
        apiKey,
        hasApiKey: providerForm.hasApiKey || apiKey.length > 0,
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

  const handleSaveTraePaths = useCallback(async () => {
    try {
      await saveTraeSettings(traeWorkspaceStoragePath.trim(), traeLogsPath.trim());
      flashStatus(setTraePathSaveStatus, 'saved');
    } catch (error) {
      console.error('Save Trae paths failed:', error);
      flashStatus(setTraePathSaveStatus, 'error', 3000);
    }
  }, [traeWorkspaceStoragePath, traeLogsPath]);

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

  const handleTestPolishModel = async () => {
    const polishModel = providerForm.polishModel.trim();
    const testModel = polishModel || providerForm.model.trim();
    if (!testModel) {
      setPolishModelTestResult({ status: 'error', message: '请先填写模型名称' });
      return;
    }
    setTestingPolishModel(true);
    setPolishModelTestResult(null);
    try {
      const testProvider: LlmProviderConfig = {
        id: providerForm.id ?? `llm-test-${Date.now()}`,
        name: providerForm.name || 'test',
        providerType: providerForm.providerType,
        model: testModel,
        polishModel: '',
        baseUrl: providerForm.baseUrl || null,
        apiKey: providerForm.apiKey,
        hasApiKey: providerForm.hasApiKey,
        isDefault: false,
      };
      const ok = await testLlmProvider(testProvider);
      setPolishModelTestResult({
        status: ok ? 'success' : 'error',
        message: ok
          ? `连接成功（${polishModel ? '润色模型' : '使用主模型'}：${testModel}）`
          : '连接失败',
      });
    } catch (error) {
      setPolishModelTestResult({
        status: 'error',
        message: formatErrorMessage(error, '连接失败'),
      });
    } finally {
      setTestingPolishModel(false);
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
              <GitLabSettingsPanel
                loading={loading}
                gitlabLoadError={gitlabLoadError}
                gitlabUrl={gitlabUrl}
                gitlabToken={gitlabToken}
                gitlabUsername={gitlabUsername}
                gitlabHasToken={gitlabHasToken}
                gitlabError={gitlabError}
                testingConnection={testingConnection}
                connectionStatus={connectionStatus}
                savingGitlab={savingGitlab}
                gitlabSaveStatus={gitlabSaveStatus}
                isGitLabConfigured={isGitLabConfigured}
                onGitlabUrlChange={(value) => {
                  setGitlabUrl(value);
                  setGitlabError('');
                  setConnectionStatus('idle');
                }}
                onGitlabTokenChange={(value) => {
                  setGitlabToken(value);
                  setGitlabError('');
                  setConnectionStatus('idle');
                }}
                onGitlabUsernameChange={(value) => {
                  setGitlabUsername(value);
                  setGitlabError('');
                }}
                onTestConnection={handleTestConnection}
                onSave={handleSaveGitlab}
              />
            )}

            {activeTab === 'github' && (
              <GitHubAccountsPanel
                githubLoadError={githubLoadError}
                githubSaveStatus={githubSaveStatus}
                githubAccounts={githubAccounts}
                testingGithubAccountId={testingGithubAccountId}
                githubConnectionStatus={githubConnectionStatus}
                onCreateAccount={openCreateGithubModal}
                onSetDefaultAccount={handleSetDefaultGithubAccount}
                onTestAccount={handleTestGithubAccount}
                onEditAccount={openEditGithubModal}
                onDeleteAccount={handleDeleteGithubAccount}
              />
            )}

            {activeTab === 'llm' && (
              <LlmProvidersPanel
                llmLoadError={llmLoadError}
                llmSaveStatus={llmSaveStatus}
                llmProviders={llmProviders}
                testingProviderId={testingProviderId}
                providerTestStatus={providerTestStatus}
                onCreateProvider={openCreateProviderModal}
                onCreateAcpProvider={openCreateAcpProviderModal}
                onSetDefaultProvider={handleSetDefaultProvider}
                onTestProvider={handleTestProvider}
                onEditProvider={openEditProviderModal}
                onDeleteProvider={handleDeleteProvider}
              />
            )}

            {activeTab === 'general' && (
              <GeneralSettingsPanel
                theme={theme}
                onThemeChange={setTheme}
                traeWorkspaceStoragePath={traeWorkspaceStoragePath}
                traeLogsPath={traeLogsPath}
                traeDefaultWorkspaceStoragePath={traeDefaultWorkspaceStoragePath}
                traeDefaultLogsPath={traeDefaultLogsPath}
                traePathSaveStatus={traePathSaveStatus}
                onTraeWorkspaceStoragePathChange={setTraeWorkspaceStoragePath}
                onTraeLogsPathChange={setTraeLogsPath}
                onTraePathsSave={handleSaveTraePaths}
              />
            )}

            {activeTab === 'data' && <DataManagementPanel />}
          </div>
        </div>
      </div>

      {showGithubModal && (
        <GitHubAccountModal
          form={githubForm}
          error={githubError}
          saving={savingGithubAccount}
          onClose={closeGithubModal}
          onNameChange={(value) =>
            setGithubForm((current) => ({ ...current, name: value }))
          }
          onUsernameChange={(value) =>
            setGithubForm((current) => ({ ...current, username: value }))
          }
          onTokenChange={(value) =>
            setGithubForm((current) => ({ ...current, token: value }))
          }
          onDefaultChange={(value) =>
            setGithubForm((current) => ({ ...current, isDefault: value }))
          }
          onSave={handleSaveGithubAccount}
        />
      )}

      {showProviderModal && (
        <ProviderModal
          form={providerForm}
          error={providerError}
          saving={savingProvider}
          acpOnly={providerModalAcpOnly}
          testingPolishModel={testingPolishModel}
          polishModelTestResult={polishModelTestResult}
          onClose={closeProviderModal}
          onNameChange={(value) =>
            setProviderForm((current) => ({ ...current, name: value }))
          }
          onProviderTypeChange={(value) =>
            setProviderForm((current) => ({ ...current, providerType: value }))
          }
          onModelChange={(value) =>
            setProviderForm((current) => ({ ...current, model: value }))
          }
          onPolishModelChange={(value) => {
            setProviderForm((current) => ({ ...current, polishModel: value }));
            setPolishModelTestResult(null);
          }}
          onBaseUrlChange={(value) =>
            setProviderForm((current) => ({ ...current, baseUrl: value }))
          }
          onApiKeyChange={(value) =>
            setProviderForm((current) => ({ ...current, apiKey: value }))
          }
          onDefaultChange={(value) =>
            setProviderForm((current) => ({ ...current, isDefault: value }))
          }
          onTestPolishModel={handleTestPolishModel}
          onSave={handleSaveProvider}
        />
      )}
    </div>
  );
}
