import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Loader2,
} from 'lucide-react';
import {
  getTask,
  listModelRuns,
  type ModelRunFromDB,
  type PromptGenerationStatus,
  type TaskFromDB,
} from '../../api/task';
import { checkCLI, cancelSession, onCLILine, onCLIDone, listSkills, type ExecMode, type ThinkingDepth, type SkillItem } from '../../api/cli';
import {
  createSession,
  deleteSession,
  getMessage,
  getSessionWithMessages,
  listSessions,
  renameSession,
  saveMessageAsPrompt,
  sendMessage,
  type ChatSession,
} from '../../api/chat';
import {
  getProjectTaskSettings,
  getTaskTypeDisplayLabel,
} from '../../api/config';
import { useAppStore } from '../../store';
import { EmptyChat, MessageBubble } from './components/PromptPrimitives';
import type { LiveMessage, TaskWorkspaceOption } from './types';
import {
  buildTaskWorkspaceOptions,
  resolvePromptTaskTypeSelection,
} from './utils/promptUtils';
import {
  PromptGenerationPanel,
  PromptSidebar,
  PromptToolbar,
} from './components/PromptPanels';
import { PromptComposer } from './components/PromptComposer';

// ── Constants ─────────────────────────────────────────────────────────────────

const MODELS = [
  { id: 'claude-opus-4-6',   label: 'Opus',   sub: '4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet', sub: '4.6' },
  { id: 'claude-haiku-4-5',  label: 'Haiku',  sub: '4.5' },
];

const THINKING_OPTIONS: Array<{ value: ThinkingDepth; label: string }> = [
  { value: '',             label: '默认'    },
  { value: 'think',        label: 'Think'   },
  { value: 'think harder', label: 'Think++' },
  { value: 'ultrathink',   label: 'Ultra'   },
];

const ASSISTANT_POLL_MS = 800;

// ── Prompt-gen panel data ─────────────────────────────────────────────────────

const TASK_TYPE_DESCRIPTIONS: Record<string, string> = {
  未归类: '暂不预设任务类别，按仓库现状出题',
  Bug修复: '定位并修复代码缺陷',
  代码生成: '从零构建新模块',
  Feature迭代: '在现有功能上扩展',
  代码理解: '解释逻辑、梳理架构',
  代码重构: '优化结构，不改变行为',
  工程化: 'CI/CD、构建、依赖管理',
  代码测试: '补充测试与验证链路',
};

const CONSTRAINT_TYPES = [
  { value: '技术栈或依赖约束', label: '技术栈约束' },
  { value: '架构或模式约束',   label: '架构约束'   },
  { value: '代码风格或规范约束', label: '代码规范约束' },
  { value: '非代码回复约束',   label: '非代码回复' },
  { value: '业务逻辑约束',     label: '业务逻辑约束' },
  { value: '无约束',           label: '无约束'     },
] as const;

const SCOPE_TYPES = [
  { value: '单文件',       label: '单文件',     desc: '10%' },
  { value: '模块内多文件', label: '模块内多文件', desc: '30%' },
  { value: '跨模块多文件', label: '跨模块多文件', desc: '30%' },
  { value: '跨系统多模块', label: '跨系统多模块', desc: '30%' },
] as const;

// ── Types ────────────────────────────────────────────────────────────────────

const PROMPT_GENERATION_STATUS_META: Record<PromptGenerationStatus, {
  label: string;
  badgeCls: string;
  panelCls: string;
}> = {
  idle: {
    label: '未生成',
    badgeCls: 'bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400',
    panelCls: 'border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/40 text-stone-500 dark:text-stone-400',
  },
  running: {
    label: '正在生成',
    badgeCls: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
    panelCls: 'border-amber-100 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-400',
  },
  done: {
    label: '已写入任务',
    badgeCls: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    panelCls: 'border-emerald-100 dark:border-emerald-900/40 bg-emerald-50 dark:bg-emerald-900/10 text-emerald-700 dark:text-emerald-400',
  },
  error: {
    label: '生成失败',
    badgeCls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    panelCls: 'border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400',
  },
};

function normalizePromptGenerationStatus(status?: string | null): PromptGenerationStatus {
  if (status === 'running' || status === 'done' || status === 'error') {
    return status;
  }
  return 'idle';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Prompt() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const allTasks = useAppStore((s) => s.tasks);
  const loadTasks = useAppStore((s) => s.loadTasks);
  const activeProject = useAppStore((s) => s.activeProject);
  const loadActiveProject = useAppStore((s) => s.loadActiveProject);

  const tasks = useMemo(
    () => allTasks.filter((t) =>
      t.status === 'Claimed' || t.status === 'PromptReady' || t.status === 'Downloaded'
    ),
    [allTasks],
  );
  const promptTaskTypes = useMemo(
    () =>
      getProjectTaskSettings(activeProject, tasks.map((task) => task.taskType)).taskTypes.map((value) => ({
        value,
        label: getTaskTypeDisplayLabel(value),
        desc: TASK_TYPE_DESCRIPTIONS[value] ?? '按当前项目配置生成对应类型题目',
      })),
    [activeProject, tasks],
  );

  // ── Global state ──────────────────────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskFromDB | null>(null);
  const [modelRuns, setModelRuns] = useState<ModelRunFromDB[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('');
  const [cliAvailable, setCliAvailable] = useState<boolean | null>(null);
  const [globalError, setGlobalError] = useState('');

  // ── Session state ─────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [loadingSession, setLoadingSession] = useState(false);

  // ── Config ────────────────────────────────────────────────────────────────
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [thinking, setThinking] = useState<ThinkingDepth>('');
  const [mode, setMode] = useState<ExecMode>('agent');
  // ── Input / execution ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeCLISession, setActiveCLISession] = useState<string | null>(null);
  const [pendingAutoSaveSessionId, setPendingAutoSaveSessionId] = useState<string | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [inputCopied, setInputCopied] = useState(false);

  // ── Prompt-gen panel ──────────────────────────────────────────────────────
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [genTaskType, setGenTaskType] = useState('');
  const [genConstraints, setGenConstraints] = useState<string[]>([]);
  const [genScopes, setGenScopes] = useState<string[]>([]);

  // ── Skills ────────────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const requestedTaskId = searchParams.get('taskId') ?? '';

  // Slash-menu state
  const [slashMenu, setSlashMenu] = useState<{
    open: boolean;
    filter: string;
    wordStart: number; // index in `input` where the '/' started
    activeIdx: number;
  }>({ open: false, filter: '', wordStart: 0, activeIdx: 0 });

  // Toolbar skill-picker state
  const [skillPicker, setSkillPicker] = useState(false);
  const [skillSearch, setSkillSearch] = useState('');
  const skillPickerRef = useRef<HTMLDivElement>(null);
  const skillSearchRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputCopyTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const previousSelectedTaskIdRef = useRef('');
  // Refs for CLI event listener cleanup functions (replaces the old setInterval poll).
  const cliLineUnsubRef = useRef<(() => void) | null>(null);
  const cliDoneUnsubRef = useRef<(() => void) | null>(null);
  const assistantPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceModelName = activeProject?.sourceModelFolder?.trim() || 'ORIGIN';
  const workspaceOptions = useMemo(
    () => buildTaskWorkspaceOptions(selectedTaskDetail, modelRuns, sourceModelName),
    [modelRuns, selectedTaskDetail, sourceModelName],
  );
  const selectedWorkspace = useMemo(
    () => workspaceOptions.find((option) => option.id === selectedWorkspaceId) ?? workspaceOptions[0] ?? null,
    [selectedWorkspaceId, workspaceOptions],
  );
  const taskLocalPath = selectedWorkspace?.path ?? null;
  const selectedTaskTypeForPrompt =
    selectedTaskDetail?.taskType ??
    allTasks.find((task) => task.id === selectedTaskId)?.taskType ??
    '';

  const refreshSelectedTaskDetail = useCallback(async (taskId: string) => {
    const task = await getTask(taskId);
    setSelectedTaskDetail(task);
    return task;
  }, []);

  const refreshSessionMessages = useCallback(async (sessionId: string) => {
    const swm = await getSessionWithMessages(sessionId);
    setMessages(swm.messages.map((m) => ({ ...m, pending: false })));
    setSessions((prev) => prev.map((s) =>
      s.id === sessionId
        ? { ...s, title: swm.session.title, updatedAt: swm.session.updatedAt, model: swm.session.model }
        : s,
    ));
  }, []);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      await Promise.all([loadTasks(), loadActiveProject()]);
      try { await checkCLI(); setCliAvailable(true); }
      catch { setCliAvailable(false); }
      try {
        const items = await listSkills();
        setSkills(items);
      } catch { /* skills are optional */ }
    })().catch(() => {});
  }, [loadActiveProject, loadTasks]);

  useEffect(() => {
    if (!selectedTaskId) {
      previousSelectedTaskIdRef.current = '';
      if (genTaskType) {
        setGenTaskType('');
      }
      return;
    }

    const taskChanged = previousSelectedTaskIdRef.current !== selectedTaskId;
    previousSelectedTaskIdRef.current = selectedTaskId;

    const nextTaskType = resolvePromptTaskTypeSelection(
      selectedTaskTypeForPrompt,
      taskChanged ? '' : genTaskType,
      promptTaskTypes,
    );
    if (nextTaskType !== genTaskType) {
      setGenTaskType(nextTaskType);
    }
  }, [genTaskType, promptTaskTypes, selectedTaskId, selectedTaskTypeForPrompt]);

  useEffect(() => {
    if (!workspaceOptions.length) {
      setSelectedWorkspaceId('');
      return;
    }
    if (selectedWorkspaceId && workspaceOptions.some((option) => option.id === selectedWorkspaceId)) {
      return;
    }
    setSelectedWorkspaceId(workspaceOptions[0].id);
  }, [selectedWorkspaceId, workspaceOptions]);

  useEffect(() => () => {
    if (inputCopyTimerRef.current) {
      window.clearTimeout(inputCopyTimerRef.current);
    }
  }, []);

  // Close skill picker on outside click
  useEffect(() => {
    if (!skillPicker) return;
    const handler = (e: MouseEvent) => {
      if (skillPickerRef.current && !skillPickerRef.current.contains(e.target as Node)) {
        setSkillPicker(false);
        setSkillSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [skillPicker]);

  // Auto-select first task
  useEffect(() => {
    if (!tasks.length) { setSelectedTaskId(''); return; }
    if (requestedTaskId && tasks.some((t) => t.id === requestedTaskId)) {
      if (selectedTaskId !== requestedTaskId) {
        setSelectedTaskId(requestedTaskId);
      }
      return;
    }
    if (!tasks.some((t) => t.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [requestedTaskId, selectedTaskId, tasks]);

  useEffect(() => {
    if (!selectedTaskId || requestedTaskId === selectedTaskId) return;
    const next = new URLSearchParams(searchParams);
    next.set('taskId', selectedTaskId);
    setSearchParams(next, { replace: true });
  }, [requestedTaskId, searchParams, selectedTaskId, setSearchParams]);

  // Load task info when task changes
  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTaskDetail(null);
      setModelRuns([]);
      setSelectedWorkspaceId('');
      return;
    }
    let cancelled = false;
    (async () => {
      const [task, taskRuns] = await Promise.all([
        getTask(selectedTaskId),
        listModelRuns(selectedTaskId),
      ]);
      if (cancelled) return;
      setSelectedTaskDetail(task);
      setModelRuns(taskRuns ?? []);
      setSelectedWorkspaceId('');
      setGlobalError('');
    })().catch((err) => {
      if (!cancelled) setGlobalError(err instanceof Error ? err.message : '加载失败');
    });
    return () => { cancelled = true; };
  }, [selectedTaskId]);

  // Reload model-scoped sessions when task or model changes
  useEffect(() => {
    if (!selectedTaskId) {
      setSessions([]);
      setActiveSessionId(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);

    (async () => {
      const sList = await listSessions(selectedTaskId, model);
      if (cancelled) return;
      setSessions(sList);
      setActiveSessionId(sList[0]?.id ?? null);
      setGlobalError('');
    })().catch((err) => {
      if (!cancelled) setGlobalError(err instanceof Error ? err.message : '加载会话失败');
    });

    return () => { cancelled = true; };
  }, [model, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    if (normalizePromptGenerationStatus(selectedTaskDetail?.promptGenerationStatus) !== 'running') {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      getTask(selectedTaskId).then((task) => {
        if (cancelled) return;
        setSelectedTaskDetail(task);
        if (normalizePromptGenerationStatus(task?.promptGenerationStatus) !== 'running') {
          void loadTasks();
        }
      }).catch(() => {});
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadTasks, selectedTaskDetail?.promptGenerationStatus, selectedTaskId]);

  useEffect(() => {
    if (!pendingAutoSaveSessionId) {
      return;
    }
    const currentPromptGenerationStatus = normalizePromptGenerationStatus(selectedTaskDetail?.promptGenerationStatus);
    if (currentPromptGenerationStatus !== 'done' && currentPromptGenerationStatus !== 'error') {
      return;
    }

    let cancelled = false;
    stopPolling();

    (async () => {
      const cliSessionId = activeCLISession;
      if (cliSessionId) {
        await cancelSession(cliSessionId).catch(() => {});
      }
      await refreshSessionMessages(pendingAutoSaveSessionId).catch(() => {});
      if (cancelled) {
        return;
      }
      setSending(false);
      setActiveCLISession(null);
      setPendingAutoSaveSessionId(null);
    })().catch(() => {
      if (cancelled) {
        return;
      }
      setSending(false);
      setActiveCLISession(null);
      setPendingAutoSaveSessionId(null);
    });

    return () => {
      cancelled = true;
    };
  }, [activeCLISession, pendingAutoSaveSessionId, refreshSessionMessages, selectedTaskDetail?.promptGenerationStatus]);

  // Load messages when active session changes
  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return; }
    let cancelled = false;
    setLoadingSession(true);
    (async () => {
      const swm = await getSessionWithMessages(activeSessionId);
      if (cancelled) return;
      setMessages(swm.messages.map((m) => ({ ...m, pending: false })));
      setLoadingSession(false);
    })().catch(() => { if (!cancelled) setLoadingSession(false); });
    return () => { cancelled = true; };
  }, [activeSessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (cliLineUnsubRef.current) cliLineUnsubRef.current();
    if (cliDoneUnsubRef.current) cliDoneUnsubRef.current();
    if (assistantPollRef.current) clearInterval(assistantPollRef.current);
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleNewSession = async () => {
    if (!selectedTaskId) return;
    try {
      const sess = await createSession(selectedTaskId, model);
      setSessions((prev) => [sess, ...prev]);
      setActiveSessionId(sess.id);
      setMessages([]);
      setInput('');
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : '创建对话失败');
    }
  };

  const handleSelectSession = (id: string) => {
    if (id === activeSessionId) return;
    stopPolling();
    setSending(false);
    setActiveCLISession(null);
    setPendingAutoSaveSessionId(null);
    setActiveSessionId(id);
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter((s) => s.id !== id);
      setActiveSessionId(remaining[0]?.id ?? null);
      setMessages([]);
    }
  };

  const handleRenameCommit = async (id: string) => {
    const title = renameValue.trim();
    if (title) {
      await renameSession(id, title).catch(() => {});
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, title } : s));
    }
    setRenamingId(null);
  };

  const stopPolling = () => {
    if (cliLineUnsubRef.current) { cliLineUnsubRef.current(); cliLineUnsubRef.current = null; }
    if (cliDoneUnsubRef.current) { cliDoneUnsubRef.current(); cliDoneUnsubRef.current = null; }
    if (assistantPollRef.current) { clearInterval(assistantPollRef.current); assistantPollRef.current = null; }
  };

  const handleStop = async () => {
    stopPolling();
    if (activeCLISession) {
      await cancelSession(activeCLISession).catch(() => {});
    }
    setMessages((prev) => prev.map((m) =>
      m.pending ? { ...m, pending: false, content: m.content + '\n\n— 已中止 —' } : m
    ));
    setSending(false);
    setActiveCLISession(null);
    setPendingAutoSaveSessionId(null);
  };

  const handleGenerate = () => {
    if (!genTaskType || genScopes.length === 0) return;
    const constraints = genConstraints.length > 0 ? genConstraints.join(',') : '无约束';
    const prompt = [
      `[PINRU] /评审项目提示词生成`,
      `taskType: ${genTaskType}`,
      `constraints: ${constraints}`,
      `scope: ${genScopes.join(',')}`,
    ].join('\n');
    setShowGenPanel(false);
    void handleSend(prompt, { autoSavePrompt: true });
  };

  const handleSend = async (
    overrideContent?: string,
    options?: {
      autoSavePrompt?: boolean;
    },
  ) => {
    const content = overrideContent ?? input.trim();
    if (!content || sending) return;
    if (!taskLocalPath) { setGlobalError('任务没有本地路径，请先完成领题 Clone'); return; }

    // Ensure there's an active session
    let sessionId = activeSessionId;
    if (!sessionId) {
      try {
        const sess = await createSession(selectedTaskId, model);
        setSessions((prev) => [sess, ...prev]);
        setActiveSessionId(sess.id);
        sessionId = sess.id;
      } catch (err) {
        setGlobalError(err instanceof Error ? err.message : '创建对话失败');
        return;
      }
    }

    if (!overrideContent) setInput('');
    setSending(true);
    setGlobalError('');

    // Optimistic: add user bubble immediately
    const tempUserMsg: LiveMessage = {
      id: `tmp-user-${Date.now()}`,
      role: 'user',
      content,
      pending: false,
    };
    const tempAssistantMsg: LiveMessage = {
      id: `tmp-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      pending: true,
    };
    setMessages((prev) => [...prev, tempUserMsg, tempAssistantMsg]);

    try {
      const resp = await sendMessage({
        sessionId,
        content,
        model,
        thinkingDepth: thinking,
        mode,
        workDir: taskLocalPath,
        permissionMode: '',
        autoSavePrompt: options?.autoSavePrompt,
      });

      setActiveCLISession(resp.cliSessionId);
      setPendingAutoSaveSessionId(options?.autoSavePrompt ? sessionId : null);
      if (options?.autoSavePrompt && selectedTaskId) {
        void Promise.all([refreshSelectedTaskDetail(selectedTaskId), loadTasks()]).catch(() => {});
      }

      // Collect CLI stream into the assistant bubble via real-time events.
      const cliLines: string[] = [];

      cliLineUnsubRef.current = onCLILine(resp.cliSessionId, (line) => {
        cliLines.push(line);
        const liveContent = cliLines.join('\n');
        setMessages((prev) => prev.map((m) =>
          m.id === tempAssistantMsg.id ? { ...m, content: liveContent } : m
        ));
      });

      cliDoneUnsubRef.current = onCLIDone(resp.cliSessionId, (errMsg) => {
        // Unsubscribe CLI event listeners immediately.
        if (cliLineUnsubRef.current) { cliLineUnsubRef.current(); cliLineUnsubRef.current = null; }
        if (cliDoneUnsubRef.current) { cliDoneUnsubRef.current(); cliDoneUnsubRef.current = null; }

        if (errMsg) {
          setMessages((prev) => prev.map((m) =>
            m.id === tempAssistantMsg.id
              ? { ...m, pending: false, content: (m.content ? m.content + '\n\n' : '') + `[执行错误: ${errMsg}]` }
              : m
          ));
          setSending(false);
          setActiveCLISession(null);
          setPendingAutoSaveSessionId(null);
          return;
        }

        // Poll DB until assistant message has content, then replace temp messages.
        assistantPollRef.current = setInterval(async () => {
          const dbMsg = await getMessage(resp.assistantMessageId).catch(() => null);
          if (dbMsg && dbMsg.content) {
            clearInterval(assistantPollRef.current!);
            assistantPollRef.current = null;
            // Replace temp messages with real DB messages
            const swm = await getSessionWithMessages(sessionId!);
            setMessages(swm.messages.map((m) => ({ ...m, pending: false })));
            setSessions((prev) => prev.map((s) =>
              s.id === sessionId
                ? { ...s, title: swm.session.title, updatedAt: swm.session.updatedAt, model: swm.session.model }
                : s
            ));
            setSending(false);
            setActiveCLISession(null);
            setPendingAutoSaveSessionId(null);
          }
        }, ASSISTANT_POLL_MS);
      });

    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAssistantMsg.id));
      setGlobalError(err instanceof Error ? err.message : '发送失败');
      if (options?.autoSavePrompt && selectedTaskId) {
        void Promise.all([refreshSelectedTaskDetail(selectedTaskId), loadTasks()]).catch(() => {});
      }
      setPendingAutoSaveSessionId(null);
      setSending(false);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    if (inputCopied) {
      setInputCopied(false);
    }

    // Detect /word pattern before cursor
    const cursor = e.target.selectionStart ?? val.length;
    const before = val.slice(0, cursor);
    const match = before.match(/(?:^|[\s\n])(\/\S*)$/);
    if (match) {
      const fullMatch = match[1]; // e.g. "/fron"
      const wordStart = before.lastIndexOf(fullMatch);
      setSlashMenu({
        open: true,
        filter: fullMatch.slice(1), // strip leading /
        wordStart,
        activeIdx: 0,
      });
    } else {
      setSlashMenu((prev) => prev.open ? { ...prev, open: false } : prev);
    }
  };

  const handleInputCopy = async () => {
    const content = input.trim();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setInputCopied(true);
      if (inputCopyTimerRef.current) {
        window.clearTimeout(inputCopyTimerRef.current);
      }
      inputCopyTimerRef.current = window.setTimeout(() => {
        setInputCopied(false);
        inputCopyTimerRef.current = null;
      }, 1500);
    } catch (err) {
      setGlobalError(err instanceof Error ? err.message : '复制失败');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu navigation
    if (slashMenu.open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIdx: Math.min(prev.activeIdx + 1, slashFilteredSkills.length - 1),
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashMenu((prev) => ({
          ...prev,
          activeIdx: Math.max(prev.activeIdx - 1, 0),
        }));
        return;
      }
      if (e.key === 'Enter') {
        const skill = slashFilteredSkills[slashMenu.activeIdx];
        if (skill) {
          e.preventDefault();
          insertSkillAtCursor(skill.name, slashMenu.wordStart);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashMenu((prev) => ({ ...prev, open: false }));
        return;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !sending) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTaskSelect = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setShowTaskPicker(false);
    stopPolling();
    setSending(false);
    setActiveCLISession(null);
    setPendingAutoSaveSessionId(null);
  }, []);

  // ── Skill helpers ─────────────────────────────────────────────────────────

  // Insert /skill-name by replacing the /word fragment from wordStart to cursor
  const insertSkillAtCursor = useCallback((skillName: string, wordStart: number) => {
    const insertion = `/${skillName} `;
    const ta = inputRef.current;
    const cursorPos = ta?.selectionStart ?? input.length;
    const newVal = input.slice(0, wordStart) + insertion + input.slice(cursorPos);
    setInput(newVal);
    setSlashMenu({ open: false, filter: '', wordStart: 0, activeIdx: 0 });
    // Restore focus and move cursor after insertion
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = wordStart + insertion.length;
      ta?.setSelectionRange(pos, pos);
    });
  }, [input]);

  // Append /skill-name from the toolbar picker
  const insertSkillFromPicker = useCallback((skillName: string) => {
    const suffix = `/${skillName} `;
    setInput((prev) => prev + suffix);
    setSkillPicker(false);
    setSkillSearch('');
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  const filteredPickerSkills = useMemo(() => {
    const q = skillSearch.toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, skillSearch]);

  const slashFilteredSkills = useMemo(() => {
    const q = slashMenu.filter.toLowerCase();
    if (!q) return skills.slice(0, 8);
    return skills.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [skills, slashMenu.filter]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const promptGenerationStatus = normalizePromptGenerationStatus(
    selectedTaskDetail?.promptGenerationStatus ?? selectedTask?.promptGenerationStatus,
  );
  const promptGenerationMeta = PROMPT_GENERATION_STATUS_META[promptGenerationStatus];
  const promptGenerationError =
    selectedTaskDetail?.promptGenerationError ??
    selectedTask?.promptGenerationError ??
    null;
  const handlePromptSaved = useCallback(() => {
    if (!selectedTaskId) {
      void loadTasks();
      return;
    }
    void Promise.all([loadTasks(), refreshSelectedTaskDetail(selectedTaskId)]).catch(() => {});
  }, [loadTasks, refreshSelectedTaskDetail, selectedTaskId]);

  useEffect(() => {
    if (activeSession?.model) {
      setModel(activeSession.model);
    }
  }, [activeSession?.id, activeSession?.model]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex overflow-hidden bg-stone-50 dark:bg-[#161615]">

      {/* ━━━ Sessions sidebar ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <PromptSidebar
        selectedTask={selectedTask}
        selectedTaskId={selectedTaskId}
        tasks={tasks}
        showTaskPicker={showTaskPicker}
        sessions={sessions}
        activeSessionId={activeSessionId}
        renamingId={renamingId}
        renameValue={renameValue}
        onToggleTaskPicker={() => setShowTaskPicker((value) => !value)}
        onSelectTask={handleTaskSelect}
        onNewSession={handleNewSession}
        onSelectSession={handleSelectSession}
        onRenameStart={(session) => {
          setRenamingId(session.id);
          setRenameValue(session.title);
        }}
        onRenameValueChange={setRenameValue}
        onRenameCommit={handleRenameCommit}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={() => navigate('/settings')}
      />

      {/* ━━━ Main chat area ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Top bar: model + thinking + mode */}
        <PromptToolbar
          models={MODELS}
          selectedModel={model}
          workspaceOptions={workspaceOptions}
          selectedWorkspace={selectedWorkspace}
          thinkingOptions={THINKING_OPTIONS}
          selectedThinking={thinking}
          mode={mode}
          cliAvailable={cliAvailable}
          selectedTaskId={selectedTaskId}
          promptGenerationMeta={promptGenerationMeta}
          showGenPanel={showGenPanel}
          taskLocalPath={taskLocalPath}
          sending={sending}
          promptGenerationStatus={promptGenerationStatus}
          onModelChange={setModel}
          onWorkspaceChange={setSelectedWorkspaceId}
          onThinkingChange={setThinking}
          onModeChange={setMode}
          onToggleGeneratePanel={() => setShowGenPanel((value) => !value)}
        />

        {/* ── Prompt-gen panel ── */}
        {showGenPanel && (
          <PromptGenerationPanel
            selectedWorkspace={selectedWorkspace}
            promptTaskTypes={promptTaskTypes}
            constraintTypes={CONSTRAINT_TYPES}
            scopeTypes={SCOPE_TYPES}
            genTaskType={genTaskType}
            genConstraints={genConstraints}
            genScopes={genScopes}
            sending={sending}
            promptGenerationStatus={promptGenerationStatus}
            onClose={() => setShowGenPanel(false)}
            onTaskTypeChange={setGenTaskType}
            onConstraintToggle={(value) =>
              setGenConstraints((prev) =>
                prev.includes(value)
                  ? prev.filter((item) => item !== value)
                  : [...prev, value],
              )
            }
            onScopeToggle={(value) =>
              setGenScopes((prev) =>
                prev.includes(value)
                  ? prev.filter((item) => item !== value)
                  : [...prev, value],
              )
            }
            onGenerate={handleGenerate}
          />
        )}

        {/* Global error */}
        {globalError && (
          <div className="flex-shrink-0 px-5 py-2 bg-red-50 dark:bg-red-900/10 border-b border-red-100 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
            {globalError}
          </div>
        )}

        {selectedTaskId && promptGenerationStatus === 'running' && (
          <div className={`flex-shrink-0 px-5 py-2 border-b text-xs ${promptGenerationMeta.panelCls}`}>
            提示词正在后台生成，完成后会自动写入当前任务。
          </div>
        )}

        {selectedTaskId && promptGenerationStatus === 'error' && promptGenerationError && (
          <div className={`flex-shrink-0 px-5 py-2 border-b text-xs ${promptGenerationMeta.panelCls}`}>
            提示词后台生成失败：{promptGenerationError}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loadingSession ? (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
            </div>
          ) : messages.length === 0 ? (
            <EmptyChat
              hasTask={!!selectedTaskId}
              hasPath={!!taskLocalPath}
              hasSession={!!activeSessionId}
              cliAvailable={cliAvailable}
              onNewSession={handleNewSession}
            />
          ) : (
            <div className="px-6 py-6 space-y-6 max-w-3xl mx-auto w-full">
              {messages.map((msg) => {
                const m = msg;
                return <MessageBubble key={m.id} message={m} taskId={selectedTaskId} messageId={m.id} onPromptSaved={handlePromptSaved} />;
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input bar ── */}
        {(activeSessionId || selectedTaskId) && (
          <PromptComposer
            activeSessionId={activeSessionId}
            selectedTaskId={selectedTaskId}
            taskLocalPath={taskLocalPath}
            cliAvailable={cliAvailable}
            input={input}
            inputCopied={inputCopied}
            sending={sending}
            skills={skills}
            skillPicker={skillPicker}
            skillSearch={skillSearch}
            slashMenu={slashMenu}
            slashFilteredSkills={slashFilteredSkills}
            filteredPickerSkills={filteredPickerSkills}
            inputRef={inputRef}
            skillPickerRef={skillPickerRef}
            skillSearchRef={skillSearchRef}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onInputCopy={() => void handleInputCopy()}
            onToggleSkillPicker={() => setSkillPicker((value) => !value)}
            onSkillSearchChange={setSkillSearch}
            onInsertSlashSkill={(skillName) =>
              insertSkillAtCursor(skillName, slashMenu.wordStart)
            }
            onInsertPickerSkill={insertSkillFromPicker}
            onStop={() => void handleStop()}
            onSend={() => void handleSend()}
          />
        )}
      </div>
    </div>
  );
}
