import {
  type Key,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BookmarkCheck,
  BookmarkPlus,
  Check,
  ChevronDown,
  CircleStop,
  Copy,
  FileText,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Slash,
  Sparkles,
  Terminal,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { getTask, type PromptGenerationStatus, type TaskFromDB } from '../services/task';
import { checkCLI, cancelSession, onCLILine, onCLIDone, listSkills, type ExecMode, type ThinkingDepth, type SkillItem, type PermissionMode } from '../services/cli';
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
} from '../services/chat';
import {
  buildProjectTaskTypes,
  getTaskTypeDisplayLabel,
} from '../services/config';
import { useAppStore } from '../store';

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

interface LiveMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  pending: boolean; // true while CLI is still running
}

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
      buildProjectTaskTypes(activeProject, tasks.map((task) => task.taskType)).map((value) => ({
        value,
        label: getTaskTypeDisplayLabel(value),
        desc: TASK_TYPE_DESCRIPTIONS[value] ?? '按当前项目配置生成对应类型题目',
      })),
    [activeProject, tasks],
  );

  // ── Global state ──────────────────────────────────────────────────────────
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<TaskFromDB | null>(null);
  const [taskLocalPath, setTaskLocalPath] = useState<string | null>(null);
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
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');

  // ── Input / execution ─────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeCLISession, setActiveCLISession] = useState<string | null>(null);

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
  // Refs for CLI event listener cleanup functions (replaces the old setInterval poll).
  const cliLineUnsubRef = useRef<(() => void) | null>(null);
  const cliDoneUnsubRef = useRef<(() => void) | null>(null);
  const assistantPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshSelectedTaskDetail = useCallback(async (taskId: string) => {
    const task = await getTask(taskId);
    setSelectedTaskDetail(task);
    setTaskLocalPath(task?.localPath ?? null);
    return task;
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
    if (genTaskType && !promptTaskTypes.some((taskType) => taskType.value === genTaskType)) {
      setGenTaskType('');
    }
  }, [genTaskType, promptTaskTypes]);

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
    if (!tasks.length) { setSelectedTaskId(''); setTaskLocalPath(null); return; }
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

  // Load task info + sessions when task changes
  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTaskDetail(null);
      setTaskLocalPath(null);
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const [task, sList] = await Promise.all([
        getTask(selectedTaskId),
        listSessions(selectedTaskId),
      ]);
      if (cancelled) return;
      setSelectedTaskDetail(task);
      setTaskLocalPath(task?.localPath ?? null);
      setSessions(sList);
      // Select most recent session, or none
      setActiveSessionId(sList[0]?.id ?? null);
      setGlobalError('');
    })().catch((err) => {
      if (!cancelled) setGlobalError(err instanceof Error ? err.message : '加载失败');
    });
    return () => { cancelled = true; };
  }, [selectedTaskId]);

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
        setTaskLocalPath(task?.localPath ?? null);
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
        permissionMode: permissionMode === 'yolo' ? 'yolo' : '',
        autoSavePrompt: options?.autoSavePrompt,
      });

      setActiveCLISession(resp.cliSessionId);
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
          }
        }, ASSISTANT_POLL_MS);
      });

    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id && m.id !== tempAssistantMsg.id));
      setGlobalError(err instanceof Error ? err.message : '发送失败');
      if (options?.autoSavePrompt && selectedTaskId) {
        void Promise.all([refreshSelectedTaskDetail(selectedTaskId), loadTasks()]).catch(() => {});
      }
      setSending(false);
    }
  };

  const handleInputChange = (e: { target: HTMLTextAreaElement }) => {
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
      <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">

        {/* Header: task picker */}
        <div className="flex-shrink-0 p-3 border-b border-stone-100 dark:border-stone-800">
          <button
            onClick={() => setShowTaskPicker((v) => !v)}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl bg-stone-50 dark:bg-stone-800 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors cursor-default"
          >
            <Terminal className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
            <span className="flex-1 text-left text-xs font-medium text-stone-600 dark:text-stone-300 truncate">
              {selectedTask?.id ?? '选择任务'}
            </span>
            <ChevronDown className="w-3 h-3 text-stone-400 flex-shrink-0" />
          </button>

          {showTaskPicker && (
            <div className="mt-1.5 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800 shadow-lg overflow-hidden">
              {tasks.length === 0 ? (
                <p className="px-3 py-2.5 text-xs text-stone-400">暂无可用任务</p>
              ) : tasks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => handleTaskSelect(t.id)}
                  className={`w-full text-left px-3 py-2 text-xs cursor-default transition-colors ${
                    t.id === selectedTaskId
                      ? 'bg-stone-100 dark:bg-stone-700 text-stone-800 dark:text-stone-200 font-medium'
                      : 'text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="block truncate">{t.id}</span>
                    {t.promptGenerationStatus === 'running' && (
                      <span className="flex-shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
                        生成中
                      </span>
                    )}
                    {t.promptGenerationStatus === 'error' && (
                      <span className="flex-shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        失败
                      </span>
                    )}
                  </div>
                  <span className="block text-[10px] text-stone-400 truncate">{t.projectName}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New chat button */}
        <div className="flex-shrink-0 px-3 py-2">
          <button
            onClick={handleNewSession}
            disabled={!selectedTaskId}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-stone-500 dark:text-stone-400 hover:bg-stone-50 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-300 transition-colors disabled:opacity-40 cursor-default"
          >
            <Plus className="w-3.5 h-3.5" />
            新建对话
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-0.5">
          {sessions.length === 0 && selectedTaskId && (
            <div className="px-3 py-4 text-center">
              <MessageSquarePlus className="w-6 h-6 text-stone-300 dark:text-stone-600 mx-auto mb-2" />
              <p className="text-xs text-stone-400 dark:text-stone-500">暂无对话</p>
            </div>
          )}
          {sessions.map((sess) => {
              const isActive = sess.id === activeSessionId;
              const isRenaming = renamingId === sess.id;
              return (
                <SessionItem
                  key={sess.id}
                  session={sess}
                  active={isActive}
                  renaming={isRenaming}
                  renameValue={renameValue}
                  onSelect={() => handleSelectSession(sess.id)}
                  onRenameStart={() => { setRenamingId(sess.id); setRenameValue(sess.title); }}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => handleRenameCommit(sess.id)}
                  onDelete={() => handleDeleteSession(sess.id)}
                />
              );
            })}
        </div>

        {/* Bottom: settings */}
        <div className="flex-shrink-0 px-3 py-3 border-t border-stone-100 dark:border-stone-800">
          <button
            onClick={() => navigate('/settings')}
            className="flex items-center gap-2 text-[11px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors cursor-default"
          >
            <Settings2 className="w-3.5 h-3.5" />
            设置
          </button>
        </div>
      </aside>

      {/* ━━━ Main chat area ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Top bar: model + thinking + mode */}
        <div className="flex-shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900">
          {/* Model pills */}
          <div className="flex items-center gap-1">
            {MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModel(m.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default ${
                  model === m.id
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                    : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

          {/* Thinking pills */}
          <div className="flex items-center gap-1">
            {THINKING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setThinking(opt.value)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default ${
                  thinking === opt.value
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                    : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

          {/* Mode toggle */}
          <div className="flex items-center rounded-full border border-stone-200 dark:border-stone-700 overflow-hidden text-[11px]">
            {(['agent', 'plan'] as ExecMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 font-medium transition-colors cursor-default ${
                  mode === m
                    ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
                    : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300'
                }`}
              >
                {m === 'agent' ? 'Agent' : 'Plan'}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-stone-200 dark:bg-stone-700" />

          {/* Permission mode toggle */}
          <button
            onClick={() => setPermissionMode((prev) => prev === 'yolo' ? 'default' : 'yolo')}
            title={permissionMode === 'yolo' ? 'YOLO 模式：跳过所有权限确认' : '默认模式：Claude 会请求权限确认'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-default ${
              permissionMode === 'yolo'
                ? 'bg-amber-500 text-white'
                : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800'
            }`}
          >
            <Zap className="w-3 h-3" />
            {permissionMode === 'yolo' ? 'YOLO' : '权限'}
          </button>

          <div className="ml-auto flex items-center gap-2">
            {cliAvailable === false && (
              <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                <TriangleAlert className="w-3.5 h-3.5" />
                <span>claude CLI 未安装</span>
              </div>
            )}

            {selectedTaskId && (
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${promptGenerationMeta.badgeCls}`}>
                提示词 {promptGenerationMeta.label}
              </span>
            )}

            <button
              onClick={() => setShowGenPanel((v) => !v)}
              disabled={!taskLocalPath || sending || promptGenerationStatus === 'running'}
              title="出题"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium transition-colors cursor-default disabled:opacity-40 ${
                showGenPanel
                  ? 'bg-indigo-600 text-white'
                  : 'text-stone-500 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              出题
            </button>
          </div>
        </div>

        {/* ── Prompt-gen panel ── */}
        {showGenPanel && (
          <div className="flex-shrink-0 border-b border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/20 px-5 py-4">
            <div className="max-w-3xl mx-auto space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">出题配置</span>
                <button onClick={() => setShowGenPanel(false)} className="text-stone-400 hover:text-stone-600 cursor-default">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Row 1: 任务类型 */}
              <div>
                <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">任务类型</p>
                <div className="flex flex-wrap gap-1.5">
                  {promptTaskTypes.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setGenTaskType(t.value)}
                      title={t.desc}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                        genTaskType === t.value
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-indigo-400 hover:text-indigo-600'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Row 2: 约束 + 范围 side by side */}
              <div className="flex gap-6">
                <div className="flex-1">
                  <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">约束种类（多选）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {CONSTRAINT_TYPES.map((c) => {
                      const active = genConstraints.includes(c.value);
                      return (
                        <button
                          key={c.value}
                          onClick={() => setGenConstraints((prev) =>
                            active ? prev.filter((x) => x !== c.value) : [...prev, c.value]
                          )}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                            active
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-emerald-400 hover:text-emerald-600'
                          }`}
                        >
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex-1">
                  <p className="text-[10px] font-medium text-stone-500 dark:text-stone-400 mb-1.5 uppercase tracking-wider">修改范围（多选）</p>
                  <div className="flex flex-wrap gap-1.5">
                    {SCOPE_TYPES.map((s) => {
                      const active = genScopes.includes(s.value);
                      return (
                        <button
                          key={s.value}
                          onClick={() => setGenScopes((prev) =>
                            active ? prev.filter((x) => x !== s.value) : [...prev, s.value]
                          )}
                          title={s.desc}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-default border ${
                            active
                              ? 'bg-amber-500 text-white border-amber-500'
                              : 'border-stone-200 dark:border-stone-700 text-stone-600 dark:text-stone-300 hover:border-amber-400 hover:text-amber-600'
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Generate button */}
              <div className="flex justify-end">
                <button
                  onClick={handleGenerate}
                  disabled={!genTaskType || genScopes.length === 0 || sending || promptGenerationStatus === 'running'}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-default disabled:opacity-40"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  开始出题
                </button>
              </div>
            </div>
          </div>
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
          <div className="flex-shrink-0 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-3">
            <div className="max-w-3xl mx-auto relative">

              {/* ── Slash menu ── */}
              {slashMenu.open && slashFilteredSkills.length > 0 && (
                <div className="absolute bottom-full mb-2 left-0 right-0 z-20 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-stone-100 dark:border-stone-800 flex items-center gap-1.5">
                    <Slash className="w-3 h-3 text-stone-400" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">技能</span>
                  </div>
                  {slashFilteredSkills.map((skill, idx) => (
                    <button
                      key={skill.name}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSkillAtCursor(skill.name, slashMenu.wordStart);
                      }}
                      className={`w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors cursor-default ${
                        idx === slashMenu.activeIdx
                          ? 'bg-stone-100 dark:bg-stone-800'
                          : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
                      }`}
                    >
                      <span className="text-xs font-mono font-semibold text-stone-700 dark:text-stone-200 shrink-0">
                        /{skill.name}
                      </span>
                      {skill.description && (
                        <span className="text-[11px] text-stone-400 dark:text-stone-500 truncate">
                          {skill.description}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Input box ── */}
              <div className="flex items-end gap-3 rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-4 py-3">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder={activeSessionId ? '继续对话… 输入 / 唤出技能（⌘↵ 发送）' : '输入第一条消息… 输入 / 唤出技能（⌘↵ 发送）'}
                  rows={3}
                  className="flex-1 bg-transparent text-sm text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none resize-none leading-[1.6]"
                />

                <button
                  onClick={() => void handleInputCopy()}
                  disabled={!input.trim()}
                  title={inputCopied ? '已复制' : '复制提示词'}
                  className={`flex-shrink-0 p-2 rounded-xl transition-colors cursor-default disabled:opacity-40 ${
                    inputCopied
                      ? 'bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                  }`}
                >
                  {inputCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>

                {/* Skill picker button */}
                {skills.length > 0 && (
                  <div className="relative flex-shrink-0" ref={skillPickerRef}>
                    <button
                      onClick={() => {
                        setSkillPicker((v) => !v);
                        setSkillSearch('');
                        requestAnimationFrame(() => skillSearchRef.current?.focus());
                      }}
                      title="技能清单"
                      className={`p-2 rounded-xl transition-colors cursor-default ${
                        skillPicker
                          ? 'bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-300'
                          : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-200 dark:hover:bg-stone-700'
                      }`}
                    >
                      <Slash className="w-4 h-4" />
                    </button>

                    {/* Skill picker dropdown */}
                    {skillPicker && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 z-20 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl overflow-hidden">
                        <div className="p-2 border-b border-stone-100 dark:border-stone-800">
                          <input
                            ref={skillSearchRef}
                            value={skillSearch}
                            onChange={(e) => setSkillSearch(e.target.value)}
                            placeholder="搜索技能…"
                            className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-1.5 text-xs text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none"
                          />
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                          {filteredPickerSkills.length === 0 ? (
                            <p className="px-3 py-3 text-xs text-stone-400 text-center">无匹配技能</p>
                          ) : filteredPickerSkills.map((skill) => (
                            <button
                              key={skill.name}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                insertSkillFromPicker(skill.name);
                              }}
                              className="w-full text-left px-3 py-2 hover:bg-stone-50 dark:hover:bg-stone-800/60 transition-colors cursor-default"
                            >
                              <span className="block text-xs font-mono font-semibold text-stone-700 dark:text-stone-200">
                                /{skill.name}
                              </span>
                              {skill.description && (
                                <span className="block text-[11px] text-stone-400 dark:text-stone-500 truncate mt-0.5">
                                  {skill.description}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {sending ? (
                  <button
                    onClick={handleStop}
                    className="flex-shrink-0 p-2 rounded-xl bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors cursor-default"
                  >
                    <CircleStop className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || !selectedTaskId || !taskLocalPath || cliAvailable === false}
                    className="flex-shrink-0 p-2 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-stone-200 text-white dark:text-stone-900 transition-colors disabled:opacity-40 cursor-default"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SessionItem({
  session,
  active,
  renaming,
  renameValue,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onDelete,
}: {
  key?: Key;
  session: ChatSession;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: () => void;
  onDelete: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  return (
    <div
      className={`group relative flex items-center gap-1 rounded-xl px-2.5 py-2 cursor-default transition-colors ${
        active
          ? 'bg-stone-100 dark:bg-stone-800'
          : 'hover:bg-stone-50 dark:hover:bg-stone-800/60'
      }`}
      onClick={onSelect}
    >
      {renaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') onRenameCommit(); if (e.key === 'Escape') onRenameChange(session.title); }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-transparent text-xs text-stone-700 dark:text-stone-300 focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-xs text-stone-600 dark:text-stone-300 truncate">{session.title}</span>
      )}

      {/* Context menu button */}
      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowMenu((v) => !v); }}
          className={`p-0.5 rounded-lg text-stone-400 transition-opacity cursor-default ${
            showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {showMenu && (
          <div className="absolute right-0 top-full mt-1 z-30 w-28 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); onRenameStart(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 cursor-default"
            >
              <Pencil className="w-3 h-3" /> 重命名
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(false); onDelete(); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-default"
            >
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message, taskId, messageId, onPromptSaved }: { key?: Key; message: LiveMessage; taskId: string; messageId: string; onPromptSaved?: () => void }) {
  const isUser = message.role === 'user';
  const displayContent = isUser ? message.content : getAssistantDisplayContent(message.content);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(displayContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveAsPrompt = async () => {
    try {
      await saveMessageAsPrompt(taskId, messageId);
      setSaved(true);
      onPromptSaved?.();
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      console.error('保存为提示词失败:', err);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        {isUser ? '你' : 'Claude'}
      </span>

      <div className={`relative group max-w-[85%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-br-md'
          : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 rounded-bl-md'
      }`}>
        {message.pending && !message.content ? (
          <div className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <pre className="font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap break-words">
            {displayContent}
          </pre>
        )}

        {/* Action buttons for non-empty, non-pending messages */}
        {displayContent && !message.pending && (
          <div className={`absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
            {/* Save as prompt button — only for assistant messages */}
            {!isUser && (
              <button
                onClick={handleSaveAsPrompt}
                title="保存为提示词"
                className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 cursor-default"
              >
                {saved ? <BookmarkCheck className="w-3 h-3" /> : <BookmarkPlus className="w-3 h-3" />}
              </button>
            )}
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className={`p-1 rounded-lg cursor-default ${
                isUser
                  ? 'text-white/60 hover:text-white/90 hover:bg-white/10'
                  : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
              }`}
            >
              {copied ? <Check className="w-3 h-3" /> : <span className="text-[10px] font-mono">copy</span>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getAssistantDisplayContent(rawContent: string): string {
  const trimmed = rawContent.trim();
  if (!trimmed.startsWith('{')) {
    return rawContent;
  }

  try {
    const parsed = JSON.parse(trimmed) as { prompt?: string; promptText?: string };
    const prompt = typeof parsed.prompt === 'string'
      ? parsed.prompt.trim()
      : typeof parsed.promptText === 'string'
        ? parsed.promptText.trim()
        : '';
    return prompt || rawContent;
  } catch {
    return rawContent;
  }
}

function EmptyChat({
  hasTask,
  hasPath,
  hasSession,
  cliAvailable,
  onNewSession,
}: {
  hasTask: boolean;
  hasPath: boolean;
  hasSession: boolean;
  cliAvailable: boolean | null;
  onNewSession: () => void;
}) {
  let body: ReactNode;

  if (!hasTask) {
    body = <p className="text-sm text-stone-400 dark:text-stone-500">请从左上角选择一个任务</p>;
  } else if (cliAvailable === false) {
    body = (
      <div className="text-center space-y-2">
        <p className="text-sm font-medium text-stone-600 dark:text-stone-400">未检测到 claude CLI</p>
        <p className="text-xs text-stone-400 dark:text-stone-500 font-mono">npm install -g @anthropic-ai/claude-code</p>
      </div>
    );
  } else if (!hasPath) {
    body = <p className="text-sm text-stone-400 dark:text-stone-500">请先在「领题」页完成代码 Clone</p>;
  } else if (!hasSession) {
    body = (
      <div className="text-center space-y-3">
        <p className="text-sm text-stone-500 dark:text-stone-400">还没有对话</p>
        <button
          onClick={onNewSession}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-sm font-semibold cursor-default hover:bg-stone-800 dark:hover:bg-stone-200 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          新建对话
        </button>
      </div>
    );
  } else {
    body = <p className="text-sm text-stone-400 dark:text-stone-500">在下方输入消息开始对话</p>;
  }

  return (
    <div className="h-full flex items-center justify-center px-8">
      {body}
    </div>
  );
}
