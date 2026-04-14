import React, { useEffect, useMemo, useState, useRef } from 'react';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Copy,
  ExternalLink,
  FileText,
  Hash,
  HelpCircle,
  LayoutDashboard,
  PlayCircle,
  Plus,
  RefreshCw,
  Settings2,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useAppStore, type Task, type TaskStatus } from '../../store';
import type { AiReviewPayload, AiReviewResult, BackgroundJob } from '../../api/job';
import type { AiReviewNodeFromDB, ModelRunFromDB, PromptGenerationStatus, TaskFromDB } from '../../api/task';
import type { GeneratePromptRequest, LlmProviderConfig } from '../../api/llm';
import {
  getTaskTypePresentation,
  normalizeTaskTypeName,
} from '../../api/config';
import {
  getSessionDecisionValue,
  isSessionCounted,
  maskSessionId,
  summarizeCountedRounds,
  type EditableTaskSession,
} from '../lib/sessionUtils';
import { matchKindLabel } from '../lib/sessionCandidateUtils';
import { formatModelRunDisplayLabel } from '../lib/sourceFolders';
import { CopyIconButton } from './CopyIconButton';
import { startClaude, onCLILine, onCLIDone } from '../../api/cli';

export type TaskDetailDrawerTab = 'sessions' | 'prompt' | 'model-runs' | 'ai-review';
export type TaskDetailDrawerModelOption = {
  modelName: string;
  localPath: string | null;
};

type ParsedAiReviewJob = {
  job: BackgroundJob;
  input: AiReviewPayload | null;
  output: AiReviewResult | null;
  modelRunId: string | null;
  localPath: string | null;
  displayName: string;
  details: AiReviewStructuredDetails | null;
};

type AiReviewStructuredDetails = {
  isCompleted: boolean | null;
  isSatisfied: boolean | null;
  projectType: string | null;
  changeScope: string | null;
  keyLocations: string | null;
};

type AiReviewStatusEntry = {
  key: string;
  modelRunId: string | null;
  displayName: string;
  localPath: string | null;
  reviewStatus: string;
  reviewRound: number;
  reviewNotes: string | null;
  nextPrompt: string | null;
  latestJob: ParsedAiReviewJob | null;
  isUnlinked: boolean;
  details: AiReviewStructuredDetails | null;
};

type AiReviewNodeDraft = {
  title: string;
  issueType: string;
  promptText: string;
  reviewNotes: string;
  polishedPromptText: string;
  polishedReviewNotes: string;
};

type StatusMetaMap = Record<TaskStatus, {
  label: string;
  dotCls: string;
  badgeCls: string;
}>;

type PromptGenerationMeta = {
  label: string;
  badgeCls: string;
  panelCls: string;
};

type SessionPatch = Partial<Pick<EditableTaskSession, 'sessionId' | 'taskType' | 'consumeQuota' | 'isCompleted' | 'isSatisfied' | 'evaluation' | 'userConversation'>>;

interface TaskDetailDrawerProps {
  selected: Task;
  selectedTaskDetail: TaskFromDB | null;
  selectedModelRuns: ModelRunFromDB[];
  selectedAiReviewNodes?: AiReviewNodeFromDB[];
  drawerLoading: boolean;
  drawerError: string;
  statusChanging: boolean;
  taskTypeChanging: boolean;
  sessionListDraft: EditableTaskSession[];
  sessionListSaving: boolean;
  sessionSaveState: 'idle' | 'saved';
  hasUnsavedSessionChanges: boolean;
  sessionExtracting: boolean;
  openSessionEditors: Set<string>;
  copiedSessionId: string | null;
  promptDraft: string;
  promptSaving: boolean;
  promptSaveState: 'idle' | 'saved';
  promptCopied: boolean;
  activeDrawerTab: TaskDetailDrawerTab;
  sessionModelOptions: TaskDetailDrawerModelOption[];
  selectedSessionModelName: string;
  sessionTaskTypeOptions: string[];
  taskTypeRemainingToCompleteByType: Record<string, number | null>;
  sourceModelName: string;
  selectedPromptGenerationStatus: PromptGenerationStatus;
  selectedPromptGenerationMeta: PromptGenerationMeta;
  selectedPromptGenerationError: string | null;
  escCloseHintVisible: boolean;
  statusMeta: StatusMetaMap;
  statusOptions: TaskStatus[];
  onClose: () => void;
  onStatusChange: (taskId: string, nextStatus: TaskStatus) => void;
  onTabChange: (tab: TaskDetailDrawerTab) => void;
  onAddSession: () => void;
  onAutoExtractSessions: () => void | Promise<void>;
  onSessionChange: (localId: string, patch: SessionPatch) => void;
  onToggleSessionEditor: (localId: string) => void;
  onSessionEditorBlur: (localId: string) => void | Promise<void>;
  onCopySessionId: (localId: string, sessionId: string) => void | Promise<void>;
  onRemoveSession: (localId: string) => void;
  onResetSessions: () => void;
  onSaveSessionList: () => void | Promise<void>;
  onPromptDraftChange: (value: string) => void;
  onPromptCopy: () => void | Promise<void>;
  onPromptReset: () => void;
  onPromptSave: () => void | Promise<void>;
  onSessionModelChange: (modelName: string) => void;
  onOpenSubmit: () => void;
  llmProviders: LlmProviderConfig[];
  promptGenerating: boolean;
  onGeneratePrompt: (config: Omit<GeneratePromptRequest, 'taskId'>) => void | Promise<void>;
  onAiReview?: (run: ModelRunFromDB) => void;
  onAiReviewNode?: (node: AiReviewNodeFromDB) => void | Promise<void>;
  onSaveAiReviewNode?: (request: {
    id: string;
    title: string;
    issueType: string;
    promptText: string;
    reviewNotes: string;
  }) => void | Promise<void>;
  onDeleteAiReviewRecord?: (jobId: string) => void | Promise<void>;
}

const TAB_ITEMS: Array<{ id: TaskDetailDrawerTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'sessions', label: 'Session 视图', icon: LayoutDashboard },
  { id: 'prompt', label: '提示词', icon: Terminal },
  { id: 'model-runs', label: '执行概况', icon: FileText },
  { id: 'ai-review', label: 'AI复审', icon: CheckCircle2 },
];

export default function TaskDetailDrawer({
  selected,
  selectedTaskDetail,
  selectedModelRuns,
  selectedAiReviewNodes,
  drawerLoading,
  drawerError,
  statusChanging,
  taskTypeChanging,
  sessionListDraft,
  sessionListSaving,
  sessionSaveState,
  hasUnsavedSessionChanges,
  sessionExtracting,
  openSessionEditors,
  copiedSessionId,
  promptDraft,
  promptSaving,
  promptSaveState,
  promptCopied,
  activeDrawerTab,
  sessionModelOptions,
  selectedSessionModelName,
  sessionTaskTypeOptions,
  taskTypeRemainingToCompleteByType,
  sourceModelName,
  selectedPromptGenerationStatus,
  selectedPromptGenerationMeta,
  selectedPromptGenerationError,
  escCloseHintVisible,
  statusMeta,
  statusOptions,
  onClose,
  onStatusChange,
  onTabChange,
  onAddSession,
  onAutoExtractSessions,
  onSessionChange,
  onToggleSessionEditor,
  onSessionEditorBlur,
  onCopySessionId,
  onRemoveSession,
  onResetSessions,
  onSaveSessionList,
  onPromptDraftChange,
  onPromptCopy,
  onPromptReset,
  onPromptSave,
  onSessionModelChange,
  onOpenSubmit,
  llmProviders,
  promptGenerating,
  onGeneratePrompt,
  onAiReview,
  onAiReviewNode,
  onSaveAiReviewNode,
  onDeleteAiReviewRecord,
}: TaskDetailDrawerProps) {
  const aiReviewVisible = useAppStore((state) => state.aiReviewVisible);
  const backgroundJobs = useAppStore((state) => state.backgroundJobs);
  const CONSTRAINT_OPTIONS = ['技术栈约束', '架构约束', '代码风格约束', '非代码回复约束', '业务逻辑约束', '无约束'];
  const SCOPE_OPTIONS = ['单文件', '模块内多文件', '跨模块多文件', '跨系统多模块'];
  const THINKING_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '', label: '默认' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' },
  ];

  const [runContextMenu, setRunContextMenu] = useState<{
    run: ModelRunFromDB;
    x: number;
    y: number;
  } | null>(null);

  const [genProviderId, setGenProviderId] = useState<string>('');
  const [genThinking, setGenThinking] = useState('');
  const [genTaskType, setGenTaskType] = useState(() =>
    normalizeTaskTypeName(selected.taskType) || '',
  );
  const [genConstraints, setGenConstraints] = useState<Set<string>>(new Set());
  const [genScopes, setGenScopes] = useState<Set<string>>(new Set());
  const [genNotes, setGenNotes] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showRegenForm, setShowRegenForm] = useState(false);
  const [submitToast, setSubmitToast] = useState(false);
  const [deletingAiReviewJobId, setDeletingAiReviewJobId] = useState<string | null>(null);
  const [deleteAiReviewError, setDeleteAiReviewError] = useState('');
  const [aiReviewNodeDrafts, setAiReviewNodeDrafts] = useState<Record<string, AiReviewNodeDraft>>({});
  const [savingAiReviewNodeId, setSavingAiReviewNodeId] = useState<string | null>(null);
  const [runningAiReviewNodeId, setRunningAiReviewNodeId] = useState<string | null>(null);
  const [aiReviewNodeError, setAiReviewNodeError] = useState('');
  const [collapsedNodeIds, setCollapsedNodeIds] = useState<Set<string>>(new Set());
  const [editingNodePrompt, setEditingNodePrompt] = useState<string | null>(null);
  const [editingNodeNotes, setEditingNodeNotes] = useState<string | null>(null);
  const [copiedNodeField, setCopiedNodeField] = useState<{ id: string; field: string } | null>(null);
  const [polishingField, setPolishingField] = useState<{ nodeId: string; field: 'promptText' | 'reviewNotes' } | null>(null);
  const polishLineUnsubRef = useRef<(() => void) | null>(null);
  const polishDoneUnsubRef = useRef<(() => void) | null>(null);
  const [conversationEditMode, setConversationEditMode] = useState<string | null>(null);
  const [copiedConversation, setCopiedConversation] = useState<string | null>(null);
  const [sessionIdEditMode, setSessionIdEditMode] = useState<string | null>(null);
  const [copiedDetailSessionId, setCopiedDetailSessionId] = useState<string | null>(null);
  const safeLlmProviders = Array.isArray(llmProviders) ? llmProviders : [];
  const safeSelectedModelRuns = Array.isArray(selectedModelRuns) ? selectedModelRuns : [];
  const safeSelectedAiReviewNodes = Array.isArray(selectedAiReviewNodes) ? selectedAiReviewNodes : [];
  const promptLlmProviders = useMemo(
    () => safeLlmProviders.filter((provider) => provider.providerType === 'claude_code_acp'),
    [safeLlmProviders],
  );

  useEffect(() => {
    if (promptLlmProviders.length === 0) {
      if (genProviderId) {
        setGenProviderId('');
      }
      return;
    }
    if (promptLlmProviders.some((provider) => provider.id === genProviderId)) {
      return;
    }

    const defaultProvider =
      promptLlmProviders.find((provider) => provider.isDefault) ?? promptLlmProviders[0];
    if (defaultProvider) {
      setGenProviderId(defaultProvider.id);
    }
  }, [promptLlmProviders, genProviderId]);

  useEffect(() => {
    if (sessionTaskTypeOptions.length === 0) return;
    const normalized = normalizeTaskTypeName(selected.taskType);
    const preferred = normalized && sessionTaskTypeOptions.includes(normalized)
      ? normalized
      : sessionTaskTypeOptions[0];
    if (!genTaskType || !sessionTaskTypeOptions.includes(genTaskType)) {
      setGenTaskType(preferred);
    }
  }, [sessionTaskTypeOptions, selected.taskType]);

  useEffect(() => {
    setDeletingAiReviewJobId(null);
    setDeleteAiReviewError('');
  }, [selected.id]);

  useEffect(() => {
    setAiReviewNodeError('');
    setSavingAiReviewNodeId(null);
    setRunningAiReviewNodeId(null);
    setCollapsedNodeIds(new Set());
    setEditingNodePrompt(null);
    setEditingNodeNotes(null);
    setCopiedNodeField(null);
    polishLineUnsubRef.current?.();
    polishDoneUnsubRef.current?.();
    polishLineUnsubRef.current = null;
    polishDoneUnsubRef.current = null;
    setPolishingField(null);
    setAiReviewNodeDrafts(
      Object.fromEntries(
        safeSelectedAiReviewNodes.map((node) => [
          node.id,
          {
            title: node.title ?? '',
            issueType: node.issueType ?? 'Bug修复',
            promptText: node.promptText ?? '',
            reviewNotes: node.reviewNotes ?? '',
            polishedPromptText: '',
            polishedReviewNotes: '',
          },
        ]),
      ),
    );
  }, [selected.id, safeSelectedAiReviewNodes]);

  const toggleGenConstraint = (c: string) => {
    setGenConstraints(prev => {
      const next = new Set(prev);
      if (c === '无约束') {
        return next.has(c) ? new Set() : new Set([c]);
      }
      next.delete('无约束');
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });
  };

  const toggleGenScope = (s: string) => {
    setGenScopes(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const handleStartGenerate = () => {
    if (!genTaskType || genScopes.size === 0) return;
    void onGeneratePrompt({
      providerId: genProviderId || null,
      taskType: genTaskType,
      scopes: [...genScopes],
      constraints: genConstraints.size > 0 ? [...genConstraints] : ['无约束'],
      additionalNotes: genNotes.trim() || null,
      thinkingBudget: genThinking,
    });
    setShowRegenForm(false);
    setSubmitToast(true);
    setTimeout(() => setSubmitToast(false), 4000);
  };

  const [activeSessionLocalId, setActiveSessionLocalId] = useState<string | null>(null);

  const getRemainingToCompleteValue = (taskType: string) => {
    const normalizedTaskType = normalizeTaskTypeName(taskType);
    if (!normalizedTaskType) {
      return null;
    }

    return taskTypeRemainingToCompleteByType[normalizedTaskType] ?? null;
  };

  const formatRemainingToComplete = (
    value: number | null,
    mode: 'option' | 'inline',
  ) => {
    if (value === null) {
      return mode === 'option' ? '' : '当前类型不限额';
    }
    return mode === 'option' ? ` · 待完成 ${value}` : `当前待完成 ${value}`;
  };

  useEffect(() => {
    if (sessionListDraft.length === 0) {
      setActiveSessionLocalId(null);
      return;
    }

    const activeStillExists = activeSessionLocalId && sessionListDraft.some((session) => session.localId === activeSessionLocalId);
    if (activeStillExists) {
      return;
    }

    const reverseSessions = [...sessionListDraft].reverse();
    const preferred =
      reverseSessions.find((session) => openSessionEditors.has(session.localId) || !session.sessionId.trim())?.localId ??
      sessionListDraft[0]?.localId ??
      null;

    setActiveSessionLocalId(preferred);
  }, [activeSessionLocalId, openSessionEditors, sessionListDraft]);

  const activeSessionIndex = useMemo(() => {
    if (sessionListDraft.length === 0) {
      return -1;
    }
    const matchedIndex = sessionListDraft.findIndex((session) => session.localId === activeSessionLocalId);
    return matchedIndex >= 0 ? matchedIndex : 0;
  }, [activeSessionLocalId, sessionListDraft]);

  const activeSession = activeSessionIndex >= 0 ? sessionListDraft[activeSessionIndex] : null;
  const sessionEvidence = activeSession?.evidence ?? null;
  const activeSessionPresentation = activeSession ? getTaskTypePresentation(activeSession.taskType) : null;
  const activeRemainingToComplete = activeSession
    ? getRemainingToCompleteValue(activeSession.taskType)
    : null;
  const executionRuns = useMemo(
    () => safeSelectedModelRuns.filter((run) => !isNonExecutionModel(run.modelName, sourceModelName)),
    [safeSelectedModelRuns, sourceModelName],
  );
  const taskAiReviewJobs = useMemo<ParsedAiReviewJob[]>(
    () =>
      backgroundJobs
        .filter((job) => job.jobType === 'ai_review' && job.taskId === selected.id)
        .slice()
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
        .map((job) => {
          const input = parseAiReviewPayload(job.inputPayload);
          const output = parseAiReviewResult(job.outputPayload);
          const details =
            extractAiReviewDetailsFromResult(output) ??
            parseAiReviewProgressDetails(job.progressMessage);
          const modelRunId = trimToNull(output?.modelRunId) ?? trimToNull(input?.modelRunId);
          const localPath = trimToNull(input?.localPath);
          return {
            job,
            input,
            output,
            modelRunId,
            localPath,
            displayName:
              trimToNull(output?.modelName) ??
              trimToNull(input?.modelName) ??
              basenameOrFallback(localPath, job.id),
            details,
          };
        }),
    [backgroundJobs, selected.id],
  );
  const latestAiReviewJobByKey = useMemo(() => {
    const map = new Map<string, ParsedAiReviewJob>();
    taskAiReviewJobs.forEach((entry) => {
      const key = buildAiReviewKey(entry.modelRunId, entry.localPath);
      if (key && !map.has(key)) {
        map.set(key, entry);
      }
    });
    return map;
  }, [taskAiReviewJobs]);
  const latestAiReviewJobByNodeId = useMemo(() => {
    const map = new Map<string, ParsedAiReviewJob>();
    taskAiReviewJobs.forEach((entry) => {
      const nodeId = trimToNull(entry.output?.reviewNodeId) ?? trimToNull(entry.input?.reviewNodeId);
      if (nodeId && !map.has(nodeId)) {
        map.set(nodeId, entry);
      }
    });
    return map;
  }, [taskAiReviewJobs]);
  const aiReviewStatusEntries = useMemo<AiReviewStatusEntry[]>(() => {
    const entries: AiReviewStatusEntry[] = [];
    const seenRunIds = new Set<string>();
    const seenPaths = new Set<string>();

    safeSelectedModelRuns.forEach((run) => {
      const normalizedRunId = trimToNull(run.id);
      const normalizedPath = trimToNull(run.localPath);
      if (!normalizedPath && run.reviewStatus === 'none') {
        return;
      }

      const latestJob =
        latestAiReviewJobByKey.get(buildAiReviewKey(run.id, run.localPath) ?? '') ??
        latestAiReviewJobByKey.get(buildAiReviewKey(null, run.localPath) ?? '') ??
        null;
      const latestOutput = latestJob?.output ?? null;
      entries.push({
        key: normalizedRunId ?? normalizedPath ?? `run:${run.modelName}`,
        modelRunId: normalizedRunId,
        displayName: formatModelRunDisplayLabel(
          run.modelName,
          run.localPath,
          sourceModelName,
        ),
        localPath: normalizedPath,
        reviewStatus: run.reviewStatus,
        reviewRound: run.reviewRound,
        reviewNotes:
          meaningfulAiReviewText(latestOutput?.reviewNotes) ??
          meaningfulAiReviewText(run.reviewNotes),
        nextPrompt: meaningfulAiReviewText(latestOutput?.nextPrompt),
        latestJob,
        isUnlinked: false,
        details: latestJob?.details ?? null,
      });
      if (normalizedRunId) {
        seenRunIds.add(normalizedRunId);
      }
      if (normalizedPath) {
        seenPaths.add(normalizedPath);
      }
    });

    latestAiReviewJobByKey.forEach((jobEntry, key) => {
      const normalizedRunId = trimToNull(jobEntry.modelRunId);
      const normalizedPath = trimToNull(jobEntry.localPath);
      if ((normalizedRunId && seenRunIds.has(normalizedRunId)) || (normalizedPath && seenPaths.has(normalizedPath))) {
        return;
      }

      entries.push({
        key,
        modelRunId: normalizedRunId,
        displayName: jobEntry.displayName,
        localPath: normalizedPath,
        reviewStatus: deriveReviewStatusFromJob(jobEntry),
        reviewRound: jobEntry.output?.reviewRound ?? 0,
        reviewNotes:
          meaningfulAiReviewText(jobEntry.output?.reviewNotes) ??
          trimToNull(jobEntry.job.errorMessage),
        nextPrompt: meaningfulAiReviewText(jobEntry.output?.nextPrompt),
        latestJob: jobEntry,
        isUnlinked: !normalizedRunId,
        details: jobEntry.details,
      });
    });

    return entries;
  }, [latestAiReviewJobByKey, safeSelectedModelRuns, sourceModelName]);
  const aiReviewPassCount = safeSelectedAiReviewNodes.filter((node) => node.status === 'pass').length;
  const aiReviewWarningCount = safeSelectedAiReviewNodes.filter((node) => node.status === 'warning').length;
  const aiReviewRunningCount = safeSelectedAiReviewNodes.filter((node) => node.status === 'running').length;
  const aiReviewTreeNodes = useMemo(
    () => buildAiReviewTreeNodes(safeSelectedAiReviewNodes),
    [safeSelectedAiReviewNodes],
  );
  const availableTabItems = useMemo(
    () => TAB_ITEMS.filter((tab) => aiReviewVisible || tab.id !== 'ai-review'),
    [aiReviewVisible],
  );
  const effectiveActiveDrawerTab =
    !aiReviewVisible && activeDrawerTab === 'ai-review'
      ? 'model-runs'
      : activeDrawerTab;
  const createdAtText = new Date(selected.createdAt * 1000).toLocaleString('zh-CN');

  const handleTabSwitch = (tab: TaskDetailDrawerTab) => {
    if (!aiReviewVisible && tab === 'ai-review') {
      return;
    }
    if (tab === effectiveActiveDrawerTab) {
      return;
    }
    if (effectiveActiveDrawerTab === 'sessions' && activeSessionLocalId) {
      void onSessionEditorBlur(activeSessionLocalId);
    }
    onTabChange(tab);
  };

  const handleSelectSession = (localId: string) => {
    if (localId === activeSessionLocalId) {
      return;
    }
    if (activeSessionLocalId) {
      void onSessionEditorBlur(activeSessionLocalId);
    }
    onToggleSessionEditor(localId);
    setActiveSessionLocalId(localId);
  };

  const handleDeleteAiReviewRecord = async (entry: ParsedAiReviewJob) => {
    if (!onDeleteAiReviewRecord) {
      return;
    }

    const label = entry.displayName || '当前记录';
    if (!window.confirm(`确定删除“${label}”的这条复审记录吗？`)) {
      return;
    }

    setDeleteAiReviewError('');
    setDeletingAiReviewJobId(entry.job.id);
    try {
      await onDeleteAiReviewRecord(entry.job.id);
    } catch (error) {
      setDeleteAiReviewError(error instanceof Error ? error.message : '删除复审记录失败');
    } finally {
      setDeletingAiReviewJobId((current) => (current === entry.job.id ? null : current));
    }
  };

  const getAiReviewNodeDraft = (node: AiReviewNodeFromDB): AiReviewNodeDraft => (
    aiReviewNodeDrafts[node.id] ?? {
      title: node.title ?? '',
      issueType: node.issueType ?? 'Bug修复',
      promptText: node.promptText ?? '',
      reviewNotes: node.reviewNotes ?? '',
      polishedPromptText: '',
      polishedReviewNotes: '',
    }
  );

  const handleAiReviewNodeDraftChange = (
    nodeId: string,
    patch: Partial<AiReviewNodeDraft>,
  ) => {
    setAiReviewNodeDrafts((prev) => {
      const current = prev[nodeId] ?? {
        title: '',
        issueType: 'Bug修复',
        promptText: '',
        reviewNotes: '',
      };
      return {
        ...prev,
        [nodeId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const handlePolishText = async (
    nodeId: string,
    field: 'promptText' | 'reviewNotes',
    text: string,
    workDir: string,
  ) => {
    if (polishingField) return;
    if (!workDir.trim()) {
      setAiReviewNodeError('润色失败：工作目录为空');
      return;
    }
    const acpProvider = promptLlmProviders[0];
    if (!acpProvider) {
      setAiReviewNodeError('润色失败：未配置 Claude Code(ACP) 提供商');
      return;
    }
    const polishModel = acpProvider.polishModel?.trim() || acpProvider.model;
    setAiReviewNodeError('');
    setPolishingField({ nodeId, field });
    polishLineUnsubRef.current?.();
    polishDoneUnsubRef.current?.();
    const collectedLines: string[] = [];
    try {
      const resp = await startClaude({
        workDir,
        prompt: `去除以下文字中的 AI 写作痕迹，使其更自然流畅。只输出改写后的文字，不要任何说明或前缀：\n\n${text}`,
        model: polishModel,
        thinkingDepth: '',
        mode: 'agent',
      });
      polishLineUnsubRef.current = onCLILine(resp.sessionId, (line) => {
        // 跳过 ANSI 控制符行和明显的工具/状态行
        // eslint-disable-next-line no-control-regex
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, '').trim();
        if (!stripped) return;
        if (/^[ℹ✓✗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏►]/.test(stripped)) return;
        if (/^(Tool:|Result:|Bash\(|Read\(|Write\(|Edit\()/.test(stripped)) return;
        collectedLines.push(stripped);
      });
      polishDoneUnsubRef.current = onCLIDone(resp.sessionId, (errMsg) => {
        polishLineUnsubRef.current?.();
        polishDoneUnsubRef.current?.();
        polishLineUnsubRef.current = null;
        polishDoneUnsubRef.current = null;
        if (errMsg) {
          setAiReviewNodeError(`润色失败：${errMsg}`);
        } else {
          const result = collectedLines.join('\n').trim();
          if (result) {
            const polishedKey = field === 'promptText' ? 'polishedPromptText' : 'polishedReviewNotes';
            handleAiReviewNodeDraftChange(nodeId, { [polishedKey]: result });
          } else {
            setAiReviewNodeError('润色失败：未能提取有效文字');
          }
        }
        setPolishingField(null);
      });
    } catch (e) {
      setAiReviewNodeError(`润色失败：${e instanceof Error ? e.message : '未知错误'}`);
      setPolishingField(null);
    }
  };

  const handleSaveAiReviewNodeDraft = async (node: AiReviewNodeFromDB) => {
    if (!onSaveAiReviewNode) {
      return true;
    }
    const draft = getAiReviewNodeDraft(node);
    setAiReviewNodeError('');
    setSavingAiReviewNodeId(node.id);
    try {
      await onSaveAiReviewNode({
        id: node.id,
        title: draft.title.trim(),
        issueType: draft.issueType.trim() || 'Bug修复',
        promptText: draft.promptText.trim(),
        reviewNotes: draft.reviewNotes.trim(),
      });
      return true;
    } catch (error) {
      setAiReviewNodeError(error instanceof Error ? error.message : '保存复审节点失败');
      return false;
    } finally {
      setSavingAiReviewNodeId((current) => (current === node.id ? null : current));
    }
  };

  const handleRunAiReviewNode = async (node: AiReviewNodeFromDB) => {
    if (!onAiReviewNode) {
      return;
    }
    if (hasAiReviewNodeDraftChanges(node, getAiReviewNodeDraft(node))) {
      const saved = await handleSaveAiReviewNodeDraft(node);
      if (!saved) {
        return;
      }
    }

    setAiReviewNodeError('');
    setRunningAiReviewNodeId(node.id);
    try {
      await onAiReviewNode(node);
    } catch (error) {
      setAiReviewNodeError(error instanceof Error ? error.message : '提交节点复核失败');
    } finally {
      setRunningAiReviewNodeId((current) => (current === node.id ? null : current));
    }
  };

  useEffect(() => {
    const sessionId = activeSession?.sessionId?.trim() ?? '';
    if (activeDrawerTab !== 'sessions' || !activeSession || !sessionId) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || !event.shiftKey || event.key.toLowerCase() !== 'c') {
        return;
      }
      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      void onCopySessionId(activeSession.localId, sessionId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeDrawerTab,
    activeSession,
    onCopySessionId,
  ]);

  const renderSessionsWorkspace = () => {
    if (!activeSession || !activeSessionPresentation) {
      return (
        <div className="flex h-full items-center justify-center px-6 text-sm text-zinc-500">
          当前没有可编辑的 session
        </div>
      );
    }

    const isCounted = isSessionCounted(activeSession, activeSessionIndex);
    const isQuotaToggleOn = activeSessionIndex === 0 ? true : activeSession.consumeQuota;
    const requiresSessionId = !activeSession.sessionId.trim();
    const isPendingCount = activeSessionIndex > 0 && isQuotaToggleOn && requiresSessionId;
    const isCompleted = getSessionDecisionValue(activeSession.isCompleted);
    const isSatisfied = getSessionDecisionValue(activeSession.isSatisfied);
    const autoExtractLabel =
      sessionModelOptions.length > 1 ? '提取当前模型 session' : '自动提取 session';
    const quotaHint =
      activeSessionIndex === 0
        ? '首个 session 固定扣减'
        : requiresSessionId
          ? (isQuotaToggleOn ? '填写 sessionId 后才会生效' : '填写 sessionId 后可开启计数')
          : formatRemainingToComplete(activeRemainingToComplete, 'inline');

    return (
      <div className="flex h-full min-h-0 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white lg:w-[320px] lg:border-b-0 lg:border-r dark:border-zinc-800/70 dark:bg-[#0c0c0f]">
          <div className="border-b border-stone-200 px-4 py-3 dark:border-zinc-800/70">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-zinc-500">Session 列表</p>
                <p className="mt-1 text-xs text-stone-600 dark:text-zinc-400">{summarizeCountedRounds(sessionListDraft)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={autoExtractLabel}
                  title={autoExtractLabel}
                  onClick={() => void onAutoExtractSessions()}
                  disabled={sessionExtracting || drawerLoading || taskTypeChanging}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-200 transition hover:bg-sky-500/15 disabled:opacity-60"
                >
                  <RefreshCw
                    className={clsx('h-3.5 w-3.5', sessionExtracting && 'animate-spin')}
                  />
                </button>
                <button
                  type="button"
                  onClick={onAddSession}
                  disabled={sessionExtracting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-60 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  新增
                </button>
              </div>
            </div>
            {sessionModelOptions.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500 dark:text-zinc-500">当前模型</p>
                {sessionModelOptions.length > 1 ? (
                  <div className="relative">
                    <select
                      value={selectedSessionModelName}
                      onChange={(event) => onSessionModelChange(event.target.value)}
                      className="w-full appearance-none rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 pr-9 text-sm font-medium text-zinc-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                    >
                      {sessionModelOptions.map((option) => (
                        <option key={option.modelName} value={option.modelName}>
                          {option.modelName}
                        </option>
                      ))}
                    </select>
                    <ChevronRight className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 rotate-90 text-zinc-500" />
                  </div>
                ) : (
                  <div className="rounded-xl border border-zinc-800 bg-black/30 px-3 py-2.5 text-sm font-medium text-zinc-200">
                    {sessionModelOptions[0]?.modelName}
                  </div>
                )}
                {sessionModelOptions.find((option) => option.modelName === selectedSessionModelName)?.localPath && (
                  <p className="break-all text-[11px] leading-5 text-zinc-500">
                    {sessionModelOptions.find((option) => option.modelName === selectedSessionModelName)?.localPath}
                  </p>
                )}
              </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-[11px]">
              <WorkspaceBadge tone={sessionListSaving ? 'warning' : hasUnsavedSessionChanges ? 'warning' : sessionSaveState === 'saved' ? 'success' : 'neutral'}>
                {sessionListSaving ? '保存中…' : hasUnsavedSessionChanges ? '待保存' : sessionSaveState === 'saved' ? '已保存' : '已同步'}
              </WorkspaceBadge>
              <WorkspaceBadge tone="neutral">共 {sessionListDraft.length || 1} 轮</WorkspaceBadge>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {sessionListDraft.map((session, index) => {
              const counted = isSessionCounted(session, index);
              const pendingCount = index > 0 && session.consumeQuota && !session.sessionId.trim();
              const selectedCard = session.localId === activeSession.localId;
              const sessionCompleted = getSessionDecisionValue(session.isCompleted);
              const sessionSatisfied = getSessionDecisionValue(session.isSatisfied);
              const preview = session.userConversation?.trim() || session.evaluation?.trim() || '当前没有补充内容';

              return (
                <div
                  key={session.localId}
                  className={clsx(
                    'w-full rounded-2xl border p-3 text-left transition',
                    selectedCard
                      ? 'border-indigo-500/35 bg-indigo-500/10 shadow-[0_0_24px_rgba(99,102,241,0.12)]'
                      : 'border-transparent bg-stone-100 hover:border-stone-200 hover:bg-stone-200/50 dark:bg-zinc-900/35 dark:hover:border-zinc-700/70 dark:hover:bg-zinc-800/40',
                  )}
                >
                  {/* 卡片头部：点击选中 */}
                  <button
                    type="button"
                    onClick={() => handleSelectSession(session.localId)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={clsx('text-xs font-semibold', selectedCard ? 'text-indigo-200' : 'text-stone-700 dark:text-zinc-200')}>
                            第 {index + 1} 轮
                          </span>
                          {index === 0 && <WorkspaceBadge tone="neutral">主 session</WorkspaceBadge>}
                          <WorkspaceBadge tone={index === 0 || counted ? 'success' : pendingCount ? 'warning' : 'neutral'}>
                            {index === 0 ? '固定计数' : counted ? '计数' : pendingCount ? '待计数' : '不计数'}
                          </WorkspaceBadge>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-stone-500 dark:text-zinc-500">{preview}</p>
                      </div>
                    </div>
                  </button>

                  {/* 任务类型 + 扣任务数开关 */}
                  <div className="mt-2.5 flex items-center gap-2">
                    {/* 任务类型下拉 */}
                    <TaskTypeSelect
                      value={session.taskType}
                      disabled={taskTypeChanging || index === 0}
                      selected={selectedCard}
                      options={sessionTaskTypeOptions.map((t) => {
                        const p = getTaskTypePresentation(t);
                        return { value: p.value, label: p.label };
                      })}
                      onChange={(val) => onSessionChange(session.localId, { taskType: val })}
                      onClick={(e) => e.stopPropagation()}
                    />

                    {/* 扣任务数开关 */}
                    <div className="group relative flex items-center gap-1.5 shrink-0">
                      {/* 帮助按钮 - 移到左侧 */}
                      <Tooltip content={index === 0 ? '首个 session 固定扣减任务数，无法更改' : '开启后将扣减对应任务类型的配额，关闭则不扣减'}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-stone-400 opacity-0 transition hover:bg-stone-100 hover:text-stone-600 group-hover:opacity-100 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                        >
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </Tooltip>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (index > 0) {
                            onSessionChange(session.localId, { consumeQuota: !session.consumeQuota });
                          }
                        }}
                        className={clsx(
                          'flex h-6 items-center gap-1.5 rounded-md border px-2.5 text-[10px] font-medium transition',
                          index === 0
                            ? 'cursor-default border-indigo-500/30 bg-indigo-500/10 text-indigo-400 opacity-70'
                            : session.consumeQuota
                              ? 'border-indigo-500/50 bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'
                              : 'border-stone-200 bg-stone-50 text-stone-500 hover:border-stone-300 hover:text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-500 dark:hover:border-zinc-600 dark:hover:text-zinc-400',
                        )}
                      >
                        <div className={clsx('h-2 w-2 rounded-full', session.consumeQuota || index === 0 ? 'bg-current' : 'bg-stone-300 dark:bg-zinc-600')} />
                        {index === 0 ? '固定' : session.consumeQuota ? '计数' : '不计'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="border-t border-stone-200 px-4 py-3 dark:border-zinc-800/70">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onResetSessions}
                disabled={sessionListSaving}
                className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
              >
                还原
              </button>
              <button
                type="button"
                onClick={() => void onSaveSessionList()}
                disabled={sessionListSaving || sessionListDraft.length === 0 || !hasUnsavedSessionChanges}
                className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
              >
                {sessionListSaving ? '保存中…' : '保存列表'}
              </button>
            </div>
          </div>
        </aside>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <motion.div
              key={activeSession.localId}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="mx-auto max-w-5xl space-y-6 px-4 py-5 pb-28 sm:px-6 lg:px-8"
            >
              <section className="flex flex-col gap-4 border-b border-stone-200 pb-4 lg:flex-row lg:items-start lg:justify-between dark:border-zinc-800/60">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold text-stone-900 dark:text-white">第 {activeSessionIndex + 1} 轮详情</h3>
                    {selectedSessionModelName && <WorkspaceBadge tone="blue">{selectedSessionModelName}</WorkspaceBadge>}
                    {activeSessionIndex === 0 && <WorkspaceBadge tone="neutral">主 session</WorkspaceBadge>}
                    <WorkspaceBadge tone={isCounted ? 'success' : isPendingCount ? 'warning' : 'neutral'}>
                      {activeSessionIndex === 0 ? '固定计数' : isCounted ? '计数中' : isPendingCount ? '待计数' : '不计数'}
                    </WorkspaceBadge>
                    <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-[10px] font-medium text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300">
                      <span className={clsx('h-1.5 w-1.5 rounded-full', activeSessionPresentation.dot)} />
                      {activeSessionPresentation.label}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-zinc-400">
                    {activeSession.userConversation?.trim() || '这一轮还没有补充用户对话信息，可以直接在下面编辑。'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {activeSessionIndex > 0 && (
                    <ActionIconButton
                      label="删除 session"
                      danger
                      onClick={() => onRemoveSession(activeSession.localId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </ActionIconButton>
                  )}
                </div>
              </section>

              <SectionBlock
                icon={Hash}
                title="会话标识"
                description="保留原始 sessionId，同时允许直接修正记录值。"
              >
                <div className="grid gap-3 lg:grid-cols-2">
                  {/* 用户对话 */}
                  <div
                    className="group rounded-2xl border border-stone-200 bg-white/60 px-4 py-3 dark:border-zinc-800/70 dark:bg-zinc-900/40"
                    onDoubleClick={() => {
                      if (conversationEditMode !== activeSession.localId) {
                        setConversationEditMode(activeSession.localId);
                      }
                    }}
                    title={conversationEditMode === activeSession.localId ? undefined : '双击编辑用户对话'}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-zinc-500">
                          用户对话
                        </p>
                        {conversationEditMode === activeSession.localId ? (
                          <textarea
                            autoFocus
                            value={activeSession.userConversation ?? ''}
                            onChange={(e) => onSessionChange(activeSession.localId, { userConversation: e.target.value })}
                            onBlur={() => setConversationEditMode(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setConversationEditMode(null);
                            }}
                            rows={5}
                            className="mt-2 w-full resize-none rounded-xl border border-indigo-500/40 bg-black/30 px-2 py-1.5 text-xs leading-6 text-stone-900 outline-none focus:ring-1 focus:ring-indigo-500/40 dark:text-zinc-200"
                          />
                        ) : (
                          <div className="mt-2 line-clamp-6 cursor-text text-xs leading-6 text-stone-800 dark:text-zinc-200">
                            {activeSession.userConversation?.trim() || (
                              <span className="text-stone-400 dark:text-zinc-600">双击添加用户对话…</span>
                            )}
                          </div>
                        )}
                      </div>
                      {activeSession.userConversation?.trim() && conversationEditMode !== activeSession.localId && (
                        <ActionIconButton
                          label={copiedConversation === activeSession.localId ? '已复制' : '复制用户对话'}
                          onClick={() => {
                            void navigator.clipboard.writeText(activeSession.userConversation ?? '').then(() => {
                              setCopiedConversation(activeSession.localId);
                              setTimeout(() => setCopiedConversation(null), 2000);
                            });
                          }}
                        >
                          {copiedConversation === activeSession.localId ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </ActionIconButton>
                      )}
                    </div>
                  </div>

                  {/* SessionID - 双击编辑 */}
                  <div
                    className="group rounded-2xl border border-stone-200 bg-white/60 px-4 py-3 dark:border-zinc-800/70 dark:bg-zinc-900/40"
                    onDoubleClick={() => {
                      if (sessionIdEditMode !== activeSession.localId) {
                        setSessionIdEditMode(activeSession.localId);
                      }
                    }}
                    title={sessionIdEditMode === activeSession.localId ? undefined : '双击编辑 Session ID'}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-zinc-500">
                          Session ID
                        </p>
                        {sessionIdEditMode === activeSession.localId ? (
                          <input
                            autoFocus
                            value={activeSession.sessionId}
                            onChange={(e) => onSessionChange(activeSession.localId, { sessionId: e.target.value })}
                            onBlur={() => setSessionIdEditMode(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape' || e.key === 'Enter') setSessionIdEditMode(null);
                            }}
                            className="mt-2 w-full rounded-xl border border-indigo-500/40 bg-black/30 px-2 py-1.5 font-mono text-xs text-stone-900 outline-none focus:ring-1 focus:ring-indigo-500/40 dark:text-zinc-200"
                            placeholder="输入 Session ID"
                          />
                        ) : (
                          <div className="mt-2 break-words cursor-text font-mono text-xs text-stone-800 dark:text-zinc-200">
                            {activeSession.sessionId?.trim() || (
                              <span className="text-stone-400 dark:text-zinc-600">双击添加 Session ID…</span>
                            )}
                          </div>
                        )}
                      </div>
                      {activeSession.sessionId?.trim() && sessionIdEditMode !== activeSession.localId && (
                        <ActionIconButton
                          label={copiedDetailSessionId === activeSession.localId ? '已复制' : '复制 Session ID'}
                          onClick={() => {
                            void navigator.clipboard.writeText(activeSession.sessionId ?? '').then(() => {
                              setCopiedDetailSessionId(activeSession.localId);
                              setTimeout(() => setCopiedDetailSessionId(null), 2000);
                            });
                          }}
                        >
                          {copiedDetailSessionId === activeSession.localId ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </ActionIconButton>
                      )}
                    </div>
                  </div>
                </div>
                {sessionEvidence && (
                  <div className="mt-4 rounded-2xl border border-sky-500/20 bg-sky-500/5 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-medium text-stone-600 dark:text-zinc-500">Session 依据</span>
                      <WorkspaceBadge tone="blue">
                        {matchKindLabel(sessionEvidence.matchKind)}
                      </WorkspaceBadge>
                      {sessionEvidence.isCurrent && (
                        <WorkspaceBadge tone="success">当前会话</WorkspaceBadge>
                      )}
                    </div>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <InfoTile label="用户">
                        {sessionEvidence.username || sessionEvidence.userId || '未记录'}
                      </InfoTile>
                      <InfoTile label="最近活动">
                        {sessionEvidence.lastActivityAt
                          ? new Date(sessionEvidence.lastActivityAt * 1000).toLocaleString('zh-CN')
                          : '未记录'}
                      </InfoTile>
                      <InfoTile label="提取时间">
                        {sessionEvidence.extractedAt
                          ? new Date(sessionEvidence.extractedAt * 1000).toLocaleString('zh-CN')
                          : '未记录'}
                      </InfoTile>
                      <InfoTile label="匹配目录">
                        {sessionEvidence.matchedPath || '未记录'}
                      </InfoTile>
                    </div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-zinc-400">
                      <p className="break-all">
                        工作区目录：{sessionEvidence.workspacePath || '未记录'}
                      </p>
                      {sessionEvidence.summary && (
                        <p>{sessionEvidence.summary}</p>
                      )}
                    </div>
                  </div>
                )}
              </SectionBlock>
            </motion.div>
          </div>
        </div>
      </div>
    );
  };

  const renderPromptGenerationForm = () => (
    <div className="space-y-5">
      {selectedPromptGenerationStatus === 'error' && selectedPromptGenerationError && (
        <StatusBanner tone="danger">上次生成失败：{selectedPromptGenerationError}</StatusBanner>
      )}
      {promptLlmProviders.length === 0 && (
        <StatusBanner tone="warning">请先在设置中配置 Claude Code (ACP) 提供商。</StatusBanner>
      )}

      {/* 任务类型 - pill 选择器 */}
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">任务类型</legend>
        <div className="flex flex-wrap gap-1.5">
          {sessionTaskTypeOptions.map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setGenTaskType(t)}
              className={clsx(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-150',
                genTaskType === t
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                  : 'border-stone-200 bg-stone-100 text-stone-600 hover:border-stone-300 hover:text-stone-700 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>

      {/* 约束类型 */}
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">约束类型</legend>
        <div className="flex flex-wrap gap-1.5">
          {CONSTRAINT_OPTIONS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => toggleGenConstraint(c)}
              className={clsx(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-150',
                genConstraints.has(c)
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                  : 'border-stone-200 bg-stone-100 text-stone-600 hover:border-stone-300 hover:text-stone-700 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </fieldset>

      {/* 修改范围 */}
      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">修改范围</legend>
        <div className="flex flex-wrap gap-1.5">
          {SCOPE_OPTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => toggleGenScope(s)}
              className={clsx(
                'rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all duration-150',
                genScopes.has(s)
                  ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.15)]'
                  : 'border-stone-200 bg-stone-100 text-stone-600 hover:border-stone-300 hover:text-stone-700 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </fieldset>

      {/* 高级选项 - 可折叠 */}
      <div className="rounded-2xl border border-zinc-800/50 bg-zinc-900/30">
        <button
          type="button"
          onClick={() => setAdvancedOpen(prev => !prev)}
          className="flex w-full items-center justify-between px-4 py-3 text-xs font-medium text-zinc-400 transition hover:text-zinc-300"
        >
          <span className="flex items-center gap-2">
            <Settings2 className="h-3.5 w-3.5" />
            高级选项
          </span>
          <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform duration-200', advancedOpen && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {advancedOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-4 border-t border-zinc-800/50 px-4 py-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">LLM 提供商</span>
                    <select
                      value={genProviderId}
                      onChange={(e) => setGenProviderId(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-indigo-500/60 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      {promptLlmProviders.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.model}){p.isDefault ? ' · 默认' : ''}
                        </option>
                      ))}
                      {promptLlmProviders.length === 0 && <option value="">请先在设置中配置</option>}
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">思考深度</span>
                    <select
                      value={genThinking}
                      onChange={(e) => setGenThinking(e.target.value)}
                      className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none focus:border-indigo-500/60 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200"
                    >
                      {THINKING_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">附加说明</span>
                  <textarea
                    value={genNotes}
                    onChange={(e) => setGenNotes(e.target.value)}
                    rows={2}
                    placeholder="对出题方向的补充描述…"
                    className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none placeholder:text-stone-400 focus:border-indigo-500/60 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-600"
                  />
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 提交按钮 */}
      <button
        type="button"
        onClick={handleStartGenerate}
        disabled={promptGenerating || !genTaskType || genScopes.size === 0 || promptLlmProviders.length === 0}
        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
      >
        {promptGenerating ? '正在生成…' : '开始出题'}
      </button>
    </div>
  );

  const hasPromptText = !!(selectedTaskDetail?.promptText || promptDraft.trim());

  const renderPromptWorkspace = () => (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6 pb-6">

        {/* Toast 提示 */}
        <AnimatePresence>
          {submitToast && (
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span className="text-sm text-emerald-300">已提交后台生成，可关闭面板继续其他操作</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 正在生成中 */}
        {promptGenerating && (
          <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-4">
            <RefreshCw className="h-4 w-4 animate-spin text-amber-400" />
            <div>
              <span className="text-sm text-amber-300">正在后台生成提示词…</span>
              <span className="ml-2 text-xs text-amber-300/60">可关闭面板，完成后自动写入</span>
            </div>
          </div>
        )}

        {/* 状态 A: 无提示词 - 显示出题配置 */}
        {!hasPromptText && !promptGenerating && (
          <SectionBlock
            icon={Wand2}
            title="出题配置"
            description="选择参数后一键生成评测提示词"
          >
            {renderPromptGenerationForm()}
          </SectionBlock>
        )}

        {/* 状态 B: 有提示词 - 显示编辑区 + 重新生成 */}
        {hasPromptText && (
          <>
            <SectionBlock
              icon={Terminal}
              title="提示词"
              description="最终可提交的提示词内容，支持手动修订和回写"
              badge={
                <div className="flex items-center gap-2">
                  <WorkspaceBadge tone={promptSaveState === 'saved' ? 'success' : 'neutral'}>
                    {promptSaveState === 'saved' ? '已保存' : '未保存'}
                  </WorkspaceBadge>
                  <button
                    type="button"
                    onClick={() => setShowRegenForm(prev => !prev)}
                    disabled={promptGenerating}
                    className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-100 px-2.5 py-0.5 text-[10px] font-medium text-stone-500 transition hover:border-indigo-500/50 hover:text-indigo-600 disabled:opacity-50 dark:border-zinc-700/60 dark:bg-zinc-900/80 dark:text-zinc-400 dark:hover:text-indigo-300"
                  >
                    <RefreshCw className="h-3 w-3" />
                    重新生成
                  </button>
                </div>
              }
            >
              <div className="space-y-3">
                {selectedPromptGenerationStatus === 'running' && !promptGenerating && (
                  <StatusBanner tone="warning">提示词正在后台生成，完成后会自动写入。</StatusBanner>
                )}

                <textarea
                  value={promptDraft}
                  onChange={(event) => onPromptDraftChange(event.target.value)}
                  rows={12}
                  placeholder="在这里直接新增或修改提示词"
                  className={clsx(
                    'min-h-[280px] w-full rounded-2xl border bg-zinc-950/70 px-4 py-4 font-mono text-xs leading-7 text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40',
                    promptGenerating ? 'border-zinc-800/40 opacity-50' : 'border-zinc-800',
                  )}
                  disabled={promptGenerating}
                />

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => void onPromptCopy()}
                    disabled={!promptDraft.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700/70 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
                  >
                    {promptCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {promptCopied ? '已复制' : '复制'}
                  </button>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onPromptReset}
                      disabled={promptSaving}
                      className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 disabled:opacity-50 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                    >
                      还原
                    </button>
                    <button
                      type="button"
                      onClick={() => void onPromptSave()}
                      disabled={promptSaving || !promptDraft.trim()}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {promptSaving ? '保存中…' : '保存'}
                    </button>
                  </div>
                </div>
              </div>
            </SectionBlock>

            {/* 重新生成表单 - 折叠展开 */}
            <AnimatePresence>
              {showRegenForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <SectionBlock
                    icon={Wand2}
                    title="重新生成配置"
                    description="调整参数后重新生成将覆盖当前提示词"
                  >
                    {renderPromptGenerationForm()}
                  </SectionBlock>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );

  const renderModelRunsWorkspace = () => (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-6 pb-6">
        <div className="grid gap-3 md:grid-cols-5">
          <InfoTile label="模型记录">{String(safeSelectedModelRuns.length)}</InfoTile>
          <InfoTile label="执行副本">{String(executionRuns.length)}</InfoTile>
          <InfoTile label="待处理">{String(executionRuns.filter((run) => run.status === 'pending').length)}</InfoTile>
          <InfoTile label="执行中">{String(executionRuns.filter((run) => run.status === 'running').length)}</InfoTile>
          <InfoTile label="已完成">{String(executionRuns.filter((run) => run.status === 'done').length)}</InfoTile>
        </div>

        <SectionBlock
          icon={FileText}
          title="工作目录"
          description="题卡本地目录和模型执行副本会集中展示在这里。"
        >
          <div className="rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 font-mono text-xs leading-6 text-stone-800 dark:border-zinc-800/70 dark:bg-zinc-950/60 dark:text-zinc-300">
            {selectedTaskDetail?.localPath || '当前题卡未记录本地目录'}
          </div>
        </SectionBlock>

        <SectionBlock
          icon={LayoutDashboard}
          title="模型执行"
          description="模型记录包含源码模型和执行副本；执行副本才会计入看板上的执行进度。"
        >
          {safeSelectedModelRuns.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-500">
              当前任务还没有模型记录。先到项目配置里的“模型列表”添加源码模型和执行副本。
            </div>
          ) : (
            <div className="space-y-3">
              {safeSelectedModelRuns.map((run) => {
                const presentation = modelRunPresentation(run.status);
                const reviewMeta = reviewStatusPresentation(run.reviewStatus, run.reviewRound);
                const codeLink = resolveModelRunCodeLink(run, sourceModelName);
                const displayLabel = formatModelRunDisplayLabel(
                  run.modelName,
                  run.localPath,
                  sourceModelName,
                );
                return (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-zinc-800/70 bg-zinc-900/35 px-4 py-4 select-none"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setRunContextMenu({ run, x: e.clientX, y: e.clientY });
                    }}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <presentation.icon className={clsx('h-4 w-4', presentation.iconCls)} />
                          <span className="font-mono text-sm text-zinc-100">{displayLabel}</span>
                          {isSourceModel(run.modelName, sourceModelName) && <WorkspaceBadge tone="neutral">源码</WorkspaceBadge>}
                          {isOriginModel(run.modelName) && <WorkspaceBadge tone="neutral">ORIGIN</WorkspaceBadge>}
                          <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', presentation.badgeCls)}>
                            {presentation.label}
                          </span>
                          {run.reviewStatus !== 'none' && (
                            <span
                              className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', reviewMeta.badgeCls)}
                              title={run.reviewNotes ?? undefined}
                            >
                              {reviewMeta.icon}
                              {reviewMeta.label}
                            </span>
                          )}
                        </div>
                        <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
                          <p className="break-all">{run.localPath || '未记录副本目录'}</p>
                          <p className="font-mono break-all">{run.branchName || '尚未创建分支'}</p>
                          <InlineCodeLink
                            label={codeLink.label}
                            url={codeLink.url}
                            copyLabel={`复制 ${run.modelName} ${codeLink.label}`}
                          />
                        </div>
                        {run.reviewStatus === 'warning' && run.reviewNotes && (
                          <p className="mt-2 text-[11px] text-amber-400/80 line-clamp-2">{run.reviewNotes}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-start gap-2 lg:items-end">
                        {onAiReview && aiReviewVisible && (
                          <button
                            type="button"
                            aria-label={run.reviewStatus === 'running' ? '复审中…' : 'AI 复审'}
                            disabled={!run.localPath || run.reviewStatus === 'running'}
                            onClick={() => {
                              onAiReview(run);
                              handleTabSwitch('ai-review');
                            }}
                            title={!run.localPath ? '需要先记录副本目录后才能发起 AI 复审' : undefined}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/25 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:bg-violet-500/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded-md border border-violet-500/20 bg-violet-500/10 text-[10px] font-semibold text-violet-300">
                              AI
                            </span>
                            {run.reviewStatus === 'running' ? '复审中…' : 'AI 复审'}
                          </button>
                        )}
                        {codeLink.url ? (
                          <a
                            href={codeLink.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 transition hover:text-white"
                          >
                            {codeLink.label === '源代码地址' ? '打开源码' : '打开代码'}
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-xs text-zinc-500">未生成代码地址</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Model run right-click context menu */}
          {runContextMenu && aiReviewVisible && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setRunContextMenu(null)}
                onContextMenu={(e) => { e.preventDefault(); setRunContextMenu(null); }}
              />
              <div
                className="fixed z-50 w-52 overflow-hidden rounded-2xl border border-zinc-700/70 bg-zinc-900/95 shadow-2xl backdrop-blur-md ring-1 ring-white/5"
                style={{ left: runContextMenu.x, top: runContextMenu.y }}
              >
                <div className="border-b border-zinc-800 px-3.5 py-2.5">
                  <p className="truncate font-mono text-[11px] text-zinc-400">{runContextMenu.run.modelName}</p>
                </div>
                <div className="py-1">
                  <button
                    type="button"
                    disabled={!runContextMenu.run.localPath || runContextMenu.run.reviewStatus === 'running'}
                    onClick={() => {
                      if (onAiReview) {
                        onAiReview(runContextMenu.run);
                        handleTabSwitch('ai-review');
                      }
                      setRunContextMenu(null);
                    }}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-medium text-zinc-200 transition hover:bg-zinc-800/70 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-300 text-[11px]">
                      AI
                    </span>
                    {runContextMenu.run.reviewStatus === 'running' ? '复审中…' : 'AI 复审'}
                  </button>
                </div>
              </div>
            </>
          )}
        </SectionBlock>
      </div>
    </div>
  );

  const renderAiReviewWorkspace = () => {
    const rootTreeNodes = aiReviewTreeNodes.filter((t) => t.depth === 1);
    const nonRootTreeNodes = aiReviewTreeNodes.filter((t) => t.depth > 1);
    const topOriginalPrompt =
      rootTreeNodes.find((t) => t.node.originalPrompt?.trim())?.node.originalPrompt?.trim() ?? null;
    const getDescendants = (rootId: string) =>
      nonRootTreeNodes.filter((t) => t.node.rootId === rootId);

    const renderNodeCard = (
      treeNode: { node: AiReviewNodeFromDB; depth: number; serial: number },
      depthOffset: number,
      displaySerial: number,
    ) => {
      const node = treeNode.node;
      const draft = getAiReviewNodeDraft(node);
      const reviewMeta =
        node.status === 'none'
          ? null
          : reviewStatusPresentation(node.status, Math.max(node.runCount, 1));
      const latestJob = latestAiReviewJobByNodeId.get(node.id) ?? null;
      const latestJobStatus = latestJob ? backgroundJobStatusPresentation(latestJob.job.status) : null;
      const dirty = hasAiReviewNodeDraftChanges(node, draft);
      const nodeDetails = extractAiReviewDetailsFromNode(node);
      const canRun = Boolean(onAiReviewNode) && Boolean(node.localPath) && node.status !== 'running';
      const isCollapsed = collapsedNodeIds.has(node.id);

      return (
        <div
          key={node.id}
          className="overflow-hidden rounded-xl border border-zinc-800/70 bg-zinc-900/40"
          style={{ marginLeft: `${Math.max(treeNode.depth - depthOffset, 0) * 20}px` }}
        >
          {/* 节点头部 */}
          <div className="flex items-start gap-2.5 px-3 py-2.5">
            <button
              type="button"
              className="mt-0.5 shrink-0 text-zinc-600 transition hover:text-zinc-300"
              onClick={() =>
                setCollapsedNodeIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
              aria-label={isCollapsed ? '展开' : '收起'}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="shrink-0 rounded-md bg-violet-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
                  #{displaySerial}
                </span>
                <span className="text-[10px] text-zinc-500">{draft.issueType || 'Bug修复'}</span>
                {reviewMeta ? (
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                      reviewMeta.badgeCls,
                    )}
                  >
                    {reviewMeta.icon}
                    {reviewMeta.label}
                  </span>
                ) : (
                  <WorkspaceBadge tone="neutral">未复审</WorkspaceBadge>
                )}
                {node.runCount > 0 && (
                  <WorkspaceBadge tone="blue">第 {node.runCount} 轮</WorkspaceBadge>
                )}
                {node.modelRunId === null && (
                  <WorkspaceBadge tone="warning">未关联模型</WorkspaceBadge>
                )}
                {dirty && <WorkspaceBadge tone="warning">待保存</WorkspaceBadge>}
                {latestJobStatus && (
                  <WorkspaceBadge tone={latestJobStatus.tone}>
                    任务{latestJobStatus.label}
                  </WorkspaceBadge>
                )}
              </div>
              <input
                value={draft.title}
                onChange={(event) =>
                  handleAiReviewNodeDraftChange(node.id, { title: event.target.value })
                }
                className="mt-1.5 w-full rounded-lg border border-zinc-800/60 bg-black/20 px-2.5 py-1.5 text-sm font-medium text-zinc-100 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                placeholder="问题标题"
              />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onSaveAiReviewNode && (
                <button
                  type="button"
                  disabled={!dirty || savingAiReviewNodeId === node.id}
                  onClick={() => void handleSaveAiReviewNodeDraft(node)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-700/70 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
                >
                  {savingAiReviewNodeId === node.id ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Check className="h-3 w-3" />
                  )}
                  保存
                </button>
              )}
              {canRun && (
                <button
                  type="button"
                  disabled={runningAiReviewNodeId === node.id}
                  onClick={() => void handleRunAiReviewNode(node)}
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5 text-xs font-medium text-violet-300 transition hover:bg-violet-500/15 disabled:opacity-40"
                >
                  {runningAiReviewNodeId === node.id ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3" />
                  )}
                  复核
                </button>
              )}
            </div>
          </div>

          {/* 可折叠主体 */}
          {!isCollapsed && (
            <div className="space-y-2.5 border-t border-zinc-800/40 px-3 py-3">
              {/* 元信息 */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
                <span className="break-all">{node.localPath || '未记录目录'}</span>
                {latestJob && (
                  <span>
                    复核于{' '}
                    {formatAiReviewTimestamp(
                      latestJob.job.finishedAt ??
                        latestJob.job.startedAt ??
                        latestJob.job.createdAt,
                    )}
                  </span>
                )}
              </div>

              {/* 问题类型（内联，不单独成卡） */}
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] font-medium text-zinc-500">问题类型</span>
                <input
                  value={draft.issueType}
                  onChange={(event) =>
                    handleAiReviewNodeDraftChange(node.id, { issueType: event.target.value })
                  }
                  className="min-w-0 flex-1 rounded-lg border border-zinc-800/60 bg-black/20 px-2.5 py-1 text-xs text-zinc-300 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/40"
                  placeholder="Bug修复"
                />
              </div>

              {/* 决策标签 + 关键代码位置 */}
              {nodeDetails && (nodeDetails.isCompleted !== null || nodeDetails.isSatisfied !== null || nodeDetails.projectType || nodeDetails.changeScope) && (
                <div className="flex flex-wrap gap-1.5">
                  <AiReviewDecisionBadge label="是否完成" value={nodeDetails.isCompleted} />
                  <AiReviewDecisionBadge label="是否满意" value={nodeDetails.isSatisfied} />
                  {nodeDetails.projectType && (
                    <WorkspaceBadge tone="blue">{nodeDetails.projectType}</WorkspaceBadge>
                  )}
                  {nodeDetails.changeScope && (
                    <WorkspaceBadge tone="neutral">{nodeDetails.changeScope}</WorkspaceBadge>
                  )}
                </div>
              )}
              {nodeDetails?.keyLocations && (
                <div className="rounded-xl border border-zinc-800/60 bg-black/15 px-3 py-2">
                  <p className="text-[10px] font-medium text-zinc-500">关键代码位置</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] leading-5 text-zinc-400">
                    {nodeDetails.keyLocations}
                  </p>
                </div>
              )}

              {/* 当前节点提示词 - 双击编辑 */}
              <div
                className="cursor-text rounded-xl border border-indigo-500/20 bg-indigo-500/8 px-3 py-2.5"
                onDoubleClick={() => {
                  if (editingNodePrompt !== node.id) setEditingNodePrompt(node.id);
                }}
                title={editingNodePrompt === node.id ? undefined : '双击编辑提示词'}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium text-indigo-400/70">推荐提示词</p>
                    {editingNodePrompt === node.id ? (
                      <textarea
                        autoFocus
                        value={draft.promptText}
                        onChange={(e) =>
                          handleAiReviewNodeDraftChange(node.id, { promptText: e.target.value })
                        }
                        onBlur={() => setEditingNodePrompt(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingNodePrompt(null);
                        }}
                        rows={4}
                        placeholder="填写该节点下一次复核要带上的提示词"
                        className="mt-1.5 w-full resize-y rounded-lg border border-indigo-500/40 bg-black/30 px-2 py-1.5 text-xs leading-6 text-indigo-100 outline-none focus:ring-1 focus:ring-indigo-500/40"
                      />
                    ) : (
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-indigo-100/90">
                        {draft.promptText || (
                          <span className="text-indigo-300/30">双击添加提示词…</span>
                        )}
                      </div>
                    )}
                    {node.nextPrompt && node.nextPrompt !== draft.promptText && (
                      <div className="mt-2 border-t border-indigo-500/15 pt-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-[9px] font-medium text-indigo-400/40">AI 建议</p>
                          <ActionIconButton
                            label="应用 AI 建议"
                            onClick={() => handleAiReviewNodeDraftChange(node.id, { promptText: node.nextPrompt, polishedPromptText: '' })}
                          >
                            <Check className="h-3 w-3" />
                          </ActionIconButton>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-5 text-indigo-200/50">
                          {node.nextPrompt}
                        </p>
                      </div>
                    )}
                    {draft.polishedPromptText && draft.polishedPromptText !== draft.promptText && (
                      <div className="mt-2 border-t border-indigo-500/15 pt-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-[9px] font-medium text-indigo-400/40">润色建议</p>
                          <ActionIconButton
                            label="应用润色建议"
                            onClick={() => handleAiReviewNodeDraftChange(node.id, { promptText: draft.polishedPromptText, polishedPromptText: '' })}
                          >
                            <Check className="h-3 w-3" />
                          </ActionIconButton>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-5 text-indigo-200/50">
                          {draft.polishedPromptText}
                        </p>
                      </div>
                    )}
                  </div>
                  {draft.promptText && editingNodePrompt !== node.id && (
                    <div className="flex items-center gap-1">
                      <ActionIconButton
                        label={
                          polishingField?.nodeId === node.id && polishingField.field === 'promptText'
                            ? '润色中…'
                            : '润色提示词'
                        }
                        disabled={!!polishingField}
                        onClick={() => {
                          void handlePolishText(node.id, 'promptText', draft.promptText, node.localPath);
                        }}
                      >
                        {polishingField?.nodeId === node.id && polishingField.field === 'promptText' ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" />
                        )}
                      </ActionIconButton>
                      <ActionIconButton
                        label={
                          copiedNodeField?.id === node.id && copiedNodeField.field === 'prompt'
                            ? '已复制'
                            : '复制提示词'
                        }
                        onClick={() => {
                          void navigator.clipboard.writeText(draft.promptText).then(() => {
                            setCopiedNodeField({ id: node.id, field: 'prompt' });
                            setTimeout(() => setCopiedNodeField(null), 2000);
                          });
                        }}
                      >
                        {copiedNodeField?.id === node.id && copiedNodeField.field === 'prompt' ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </ActionIconButton>
                    </div>
                  )}
                </div>
              </div>

              {/* 不满意结论 - 双击编辑 */}
              <div
                className="cursor-text rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-2.5"
                onDoubleClick={() => {
                  if (editingNodeNotes !== node.id) setEditingNodeNotes(node.id);
                }}
                title={editingNodeNotes === node.id ? undefined : '双击编辑不满意结论'}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-medium text-amber-400/70">不满意结论</p>
                    {editingNodeNotes === node.id ? (
                      <textarea
                        autoFocus
                        value={draft.reviewNotes}
                        onChange={(e) =>
                          handleAiReviewNodeDraftChange(node.id, { reviewNotes: e.target.value })
                        }
                        onBlur={() => setEditingNodeNotes(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingNodeNotes(null);
                        }}
                        rows={3}
                        placeholder="填写当前节点的不满意结论，子复核会带上父节点结论"
                        className="mt-1.5 w-full resize-y rounded-lg border border-amber-500/40 bg-black/30 px-2 py-1.5 text-xs leading-6 text-amber-100 outline-none focus:ring-1 focus:ring-amber-500/20"
                      />
                    ) : (
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-amber-100/90">
                        {draft.reviewNotes || (
                          <span className="text-amber-300/30">双击添加不满意结论…</span>
                        )}
                      </div>
                    )}
                    {draft.polishedReviewNotes && draft.polishedReviewNotes !== draft.reviewNotes && (
                      <div className="mt-2 border-t border-amber-500/15 pt-1.5">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-[9px] font-medium text-amber-400/40">润色建议</p>
                          <ActionIconButton
                            label="应用润色建议"
                            onClick={() => handleAiReviewNodeDraftChange(node.id, { reviewNotes: draft.polishedReviewNotes, polishedReviewNotes: '' })}
                          >
                            <Check className="h-3 w-3" />
                          </ActionIconButton>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-5 text-amber-200/50">
                          {draft.polishedReviewNotes}
                        </p>
                      </div>
                    )}
                  </div>
                  {draft.reviewNotes && editingNodeNotes !== node.id && (
                    <div className="flex items-center gap-1">
                      <ActionIconButton
                        label={
                          polishingField?.nodeId === node.id && polishingField.field === 'reviewNotes'
                            ? '润色中…'
                            : '润色结论'
                        }
                        disabled={!!polishingField}
                        onClick={() => {
                          void handlePolishText(node.id, 'reviewNotes', draft.reviewNotes, node.localPath);
                        }}
                      >
                        {polishingField?.nodeId === node.id && polishingField.field === 'reviewNotes' ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wand2 className="h-3.5 w-3.5" />
                        )}
                      </ActionIconButton>
                      <ActionIconButton
                        label={
                          copiedNodeField?.id === node.id && copiedNodeField.field === 'notes'
                            ? '已复制'
                            : '复制结论'
                        }
                        onClick={() => {
                          void navigator.clipboard.writeText(draft.reviewNotes).then(() => {
                            setCopiedNodeField({ id: node.id, field: 'notes' });
                            setTimeout(() => setCopiedNodeField(null), 2000);
                          });
                        }}
                      >
                        {copiedNodeField?.id === node.id && copiedNodeField.field === 'notes' ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </ActionIconButton>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    };

    return (
      <div className="h-full overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl space-y-6 pb-6">
          {/* 统计概况 */}
          <div className="grid gap-3 md:grid-cols-4">
            <InfoTile label="问题节点">
              {String(nonRootTreeNodes.length > 0 ? nonRootTreeNodes.length : safeSelectedAiReviewNodes.length)}
            </InfoTile>
            <InfoTile label="复审通过">{String(aiReviewPassCount)}</InfoTile>
            <InfoTile label="复审未过">{String(aiReviewWarningCount)}</InfoTile>
            <InfoTile label="复审中">{String(aiReviewRunningCount)}</InfoTile>
          </div>

          {/* 原始任务提示词 - 顶层展示 */}
          {topOriginalPrompt && (
            <SectionBlock icon={Terminal} title="原始任务提示词" description="首轮审核所用的完整任务提示词。">
              <AiReviewTextCard
                title=""
                value={topOriginalPrompt}
                copyLabel="复制原始任务提示词"
                tone="indigo"
              />
            </SectionBlock>
          )}

          {/* 复核树 */}
          <SectionBlock
            icon={CheckCircle2}
            title="复核树"
            description="首轮审核是组织者：发现多个问题时自动拆分为子节点，每个子节点可独立进行多轮复核。"
          >
            {aiReviewNodeError && (
              <p className="mb-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {aiReviewNodeError}
              </p>
            )}
            {rootTreeNodes.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500 dark:border-zinc-800 dark:bg-zinc-900/20 dark:text-zinc-500">
                还没有复核树。先在「执行概况」里发起一次首轮 AI 复核。
              </div>
            ) : (
              <div className="space-y-5">
                {rootTreeNodes.map((rootTreeNode) => {
                  const rootNode = rootTreeNode.node;
                  const rootReviewMeta =
                    rootNode.status === 'none'
                      ? null
                      : reviewStatusPresentation(rootNode.status, Math.max(rootNode.runCount, 1));
                  const rootLatestJob = latestAiReviewJobByNodeId.get(rootNode.id) ?? null;
                  const descendants = getDescendants(rootNode.id);

                  return (
                    <div key={rootNode.id} className="space-y-2">
                      {/* 首轮审核 organizer */}
                      <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-300">首轮审核</span>
                          {rootReviewMeta ? (
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                rootReviewMeta.badgeCls,
                              )}
                            >
                              {rootReviewMeta.icon}
                              {rootReviewMeta.label}
                            </span>
                          ) : (
                            <WorkspaceBadge tone="neutral">未复审</WorkspaceBadge>
                          )}
                          {rootNode.runCount > 0 && (
                            <WorkspaceBadge tone="blue">已执行 {rootNode.runCount} 次</WorkspaceBadge>
                          )}
                          {rootNode.modelRunId === null && (
                            <WorkspaceBadge tone="warning">未关联模型</WorkspaceBadge>
                          )}
                        </div>
                        <p className="mt-1 break-all text-xs text-zinc-500">
                          {rootNode.localPath || '未记录目录'}
                        </p>
                        {rootLatestJob && (
                          <p className="mt-0.5 text-xs text-zinc-600">
                            最近复核：
                            {formatAiReviewTimestamp(
                              rootLatestJob.job.finishedAt ??
                                rootLatestJob.job.startedAt ??
                                rootLatestJob.job.createdAt,
                            )}
                          </p>
                        )}
                        {rootNode.reviewNotes?.trim() && (
                          <div className="mt-3 border-t border-zinc-700/40 pt-3">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-amber-300">
                              首轮发现问题
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-6 text-amber-100/80">
                              {rootNode.reviewNotes}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 子问题列表 */}
                      {descendants.length === 0 ? (
                        rootNode.status === 'none' || rootNode.status === 'running' ? (
                          <div className="rounded-2xl border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
                            首轮复核完成后，发现的问题会在这里自动展开。
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-emerald-800/40 bg-emerald-900/10 px-4 py-6 text-center text-sm text-emerald-400">
                            首轮审核通过，未发现需修复的子问题。
                          </div>
                        )
                      ) : (
                        <div className="space-y-2 pl-2">
                          {descendants.map((treeNode, idx) => renderNodeCard(treeNode, 2, idx + 1))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionBlock>
        </div>
      </div>
    );
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-20 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_28%),rgba(0,0,0,0.3)] backdrop-blur-xl dark:bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.16),transparent_28%),rgba(0,0,0,0.78)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.985 }}
        transition={{ type: 'spring', damping: 22, stiffness: 220 }}
        onClick={onClose}
        className="fixed inset-0 z-30 flex items-center justify-center p-2 sm:p-4 lg:p-6"
      >
        <div
          onClick={(event) => event.stopPropagation()}
          className="flex h-full max-h-[960px] w-full max-w-[1420px] flex-col overflow-hidden rounded-[28px] border border-stone-200 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.15)] ring-1 ring-black/5 dark:border-zinc-800/80 dark:bg-[#0a0a0c]/95 dark:shadow-[0_30px_120px_rgba(0,0,0,0.55)] dark:ring-white/5"
        >
          <header className="border-b border-stone-200 bg-white px-4 py-4 sm:px-5 lg:px-6 dark:border-zinc-800/70 dark:bg-[#0b0b0e]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className={clsx('h-2 w-2 rounded-full', statusMeta[selected.status].dotCls)} />
                  <select
                    value={selected.status}
                    disabled={statusChanging}
                    onChange={(event) => onStatusChange(selected.id, event.target.value as TaskStatus)}
                    className={clsx(
                      'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] outline-none',
                      taskStatusTone(selected.status),
                    )}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {statusMeta[status].label}
                      </option>
                    ))}
                  </select>
                  <WorkspaceBadge tone="neutral">{sessionListDraft.length || 1} 个 session</WorkspaceBadge>
                  <span className={clsx('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold', promptStatusTone(selectedPromptGenerationStatus))}>
                    提示词 {selectedPromptGenerationMeta.label}
                  </span>
                </div>
                <h2 className="mt-3 truncate text-xl font-semibold tracking-tight text-stone-900 dark:text-white">{selected.projectName}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-stone-500 dark:text-zinc-500">
                  <span className="inline-flex items-center gap-1 font-mono">
                    <Hash className="h-3.5 w-3.5" />
                    #{selected.projectId}
                  </span>
                  <span className="font-mono text-zinc-600">{selected.id}</span>
                  <span>{createdAtText}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-xl border border-stone-200 bg-stone-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900/80">
                  {availableTabItems.map((tab) => {
                    const Icon = tab.icon;
                    const active = effectiveActiveDrawerTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => handleTabSwitch(tab.id)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition',
                          active ? 'bg-white text-stone-900 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-stone-500 hover:text-stone-700 dark:text-zinc-400 dark:hover:text-zinc-200',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
              </div>

                <ActionIconButton label="关闭" onClick={onClose}>
                  <X className="h-4 w-4" />
                </ActionIconButton>
              </div>
            </div>
          </header>

          {escCloseHintVisible && (
            <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:px-5 lg:px-6">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-amber-300" />
                <span>再按一次 </span>
                <kbd className="rounded-md border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-200">
                  Esc
                </kbd>
                <span> 关闭这个编辑框</span>
              </div>
            </div>
          )}

          {drawerError && (
            <div className="border-b border-red-500/15 bg-red-500/10 px-4 py-3 text-sm text-red-200 sm:px-5 lg:px-6">
              {drawerError}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden bg-stone-50 dark:bg-[#09090b]">
            {drawerLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">正在加载任务详情…</div>
            ) : (
              <>
                {effectiveActiveDrawerTab === 'sessions' && renderSessionsWorkspace()}
                {effectiveActiveDrawerTab === 'prompt' && renderPromptWorkspace()}
                {effectiveActiveDrawerTab === 'model-runs' && renderModelRunsWorkspace()}
                {effectiveActiveDrawerTab === 'ai-review' && aiReviewVisible && renderAiReviewWorkspace()}
              </>
            )}
          </div>

          <footer className="border-t border-stone-200 bg-white px-4 py-4 sm:px-5 lg:px-6 dark:border-zinc-800/70 dark:bg-[#0b0b0e]">
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onOpenSubmit}
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                提交代码
              </button>
            </div>
          </footer>
        </div>
      </motion.div>
    </>
  );
}

function ActionIconButton({
  children,
  danger,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border transition',
        danger
          ? 'border-red-500/20 bg-red-500/10 text-red-600 hover:bg-red-500/15 dark:text-red-300'
          : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-white',
        disabled && 'cursor-not-allowed opacity-50 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-300',
      )}
    >
      {children}
    </button>
  );
}

function InlineCodeLink({
  label,
  url,
  copyLabel,
}: {
  label: string;
  url: string | null;
  copyLabel: string;
}) {
  if (!url) {
    return (
      <p className="flex items-center gap-2">
        <span className="shrink-0 text-zinc-500">{label}</span>
        <span className="font-mono text-zinc-600">未生成</span>
      </p>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <span className="shrink-0 text-zinc-500">{label}</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className="min-w-0 flex-1 break-all font-mono text-zinc-300 transition hover:text-white"
      >
        {url}
      </a>
      <div className="flex items-center gap-1">
        <CopyIconButton
          value={url}
          label={copyLabel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-black/20 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
          iconClassName="h-3.5 w-3.5"
        />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={`打开 ${label}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-black/20 text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-white"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}

function WorkspaceBadge({
  children,
  tone,
  className,
}: {
  children: React.ReactNode;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'purple' | 'blue';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-stone-200 bg-stone-100 text-stone-600 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200',
    danger: 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200',
    purple: 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200',
    blue: 'border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-200',
  };

  return (
    <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium', tones[tone], className)}>
      {children}
    </span>
  );
}

function SectionBlock({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-[24px] border border-stone-200 bg-white/60 p-4 sm:p-5 dark:border-zinc-800/70 dark:bg-zinc-900/35">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-stone-800 dark:text-zinc-100">
            <Icon className="h-4 w-4 text-indigo-400" />
            {title}
          </div>
          <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-zinc-500">{description}</p>
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function InfoTile({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white/60 px-4 py-3 dark:border-zinc-800/70 dark:bg-zinc-900/40">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-zinc-500">{label}</p>
      <div className={clsx('mt-2 break-all text-sm text-stone-800 dark:text-zinc-200', mono && 'font-mono text-xs leading-6')}>{children}</div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <span className="block text-[11px] font-medium text-zinc-500">{label}</span>;
}

function StatusBanner({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'warning' | 'danger';
}) {
  return (
    <div className={clsx(
      'rounded-2xl border px-4 py-3 text-xs',
      tone === 'warning'
        ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200'
        : 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200',
    )}>
      {children}
    </div>
  );
}

function SessionSwitchCard({
  label,
  description,
  checked,
  disabled,
  onChange,
  onLabel,
  offLabel,
  tone,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onLabel: string;
  offLabel: string;
  tone: 'indigo' | 'emerald';
}) {
  const activeTone =
    tone === 'emerald'
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
      : 'border-indigo-500/20 bg-indigo-500/10 text-indigo-100';
  const trackTone = tone === 'emerald' ? 'bg-emerald-500' : 'bg-indigo-500';

  return (
    <div className={clsx(
      'flex items-center justify-between gap-3 rounded-2xl border px-3 py-3 transition',
      checked ? activeTone : 'border-zinc-800 bg-black/20 text-zinc-300',
      disabled && 'opacity-60',
    )}>
      <div className="min-w-0">
        <p className="text-xs font-semibold">{label}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <WorkspaceBadge tone={checked ? tone === 'emerald' ? 'success' : 'purple' : 'neutral'}>
            {checked ? onLabel : offLabel}
          </WorkspaceBadge>
          <p className="text-[10px] leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition',
          checked ? trackTone : 'bg-zinc-700',
        )}
      >
        <span
          className={clsx(
            'inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

function BinaryChoiceGroup({
  title,
  value,
  positiveLabel,
  negativeLabel,
  onPositive,
  onNegative,
}: {
  title: string;
  value: boolean;
  positiveLabel: string;
  negativeLabel: string;
  onPositive: () => void;
  onNegative: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-zinc-800/70 bg-black/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-semibold text-zinc-200">{title}</p>
        <p className="mt-1 text-[11px] text-zinc-500">用更明确的判断替代模糊备注。</p>
      </div>
      <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-900/80 p-1">
        <button
          type="button"
          onClick={onPositive}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-500 hover:text-zinc-200',
          )}
        >
          {positiveLabel}
        </button>
        <button
          type="button"
          onClick={onNegative}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition',
            !value ? 'bg-red-500/20 text-red-200' : 'text-zinc-500 hover:text-zinc-200',
          )}
        >
          {negativeLabel}
        </button>
      </div>
    </div>
  );
}

function AiReviewDecisionBadge({
  label,
  value,
}: {
  label: string;
  value: boolean | null;
}) {
  if (value === null) {
    return <WorkspaceBadge tone="neutral">{label}：未记录</WorkspaceBadge>;
  }

  return (
    <WorkspaceBadge tone={value ? 'success' : 'danger'}>
      {label}：{value ? '是' : '否'}
    </WorkspaceBadge>
  );
}

function AiReviewTextCard({
  title,
  value,
  copyLabel,
  tone,
}: {
  title: string;
  value: string;
  copyLabel: string;
  tone: 'warning' | 'indigo';
}) {
  const styles = tone === 'warning'
    ? {
      panel: 'border-amber-500/20 bg-amber-500/10',
      title: 'text-amber-300',
      text: 'text-amber-100',
      button:
        'border-amber-500/20 bg-amber-500/10 text-amber-200 hover:border-amber-400/40 hover:bg-amber-500/15 hover:text-amber-100',
    }
    : {
      panel: 'border-indigo-500/20 bg-indigo-500/10',
      title: 'text-indigo-300',
      text: 'text-indigo-100',
      button:
        'border-indigo-500/20 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400/40 hover:bg-indigo-500/15 hover:text-indigo-100',
    };

  return (
    <div className={clsx('rounded-2xl border px-4 py-3', styles.panel)}>
      <div className="flex items-center justify-between gap-3">
        <p className={clsx('text-[10px] font-semibold uppercase tracking-[0.22em]', styles.title)}>
          {title}
        </p>
        <CopyIconButton
          value={value}
          label={copyLabel}
          className={clsx(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg transition',
            styles.button,
          )}
          iconClassName="h-3.5 w-3.5"
        />
      </div>
      <p className={clsx('mt-2 text-sm leading-6', styles.text)}>{value}</p>
    </div>
  );
}

function taskStatusTone(status: TaskStatus) {
  switch (status) {
    case 'Claimed':
      return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-200';
    case 'Downloading':
      return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200';
    case 'Downloaded':
      return 'border-stone-300 bg-stone-100 text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200';
    case 'PromptReady':
      return 'border-indigo-500/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200';
    case 'ExecutionCompleted':
      return 'border-cyan-500/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200';
    case 'Submitted':
      return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200';
    case 'Error':
      return 'border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200';
    default:
      return 'border-stone-300 bg-stone-100 text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-200';
  }
}

function promptStatusTone(status: PromptGenerationStatus) {
  switch (status) {
    case 'running':
      return 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-200';
    case 'done':
      return 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200';
    case 'error':
      return 'border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-200';
    default:
      return 'border border-stone-300 bg-stone-100 text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300';
  }
}

function isOriginModel(modelName: string) {
  return modelName.trim().toUpperCase() === 'ORIGIN';
}

function isSourceModel(modelName: string, sourceModelName: string) {
  return modelName.trim().toUpperCase() === sourceModelName.trim().toUpperCase();
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

function isNonExecutionModel(modelName: string, sourceModelName: string) {
  return isOriginModel(modelName) || isSourceModel(modelName, sourceModelName);
}

function resolveModelRunCodeLink(run: ModelRunFromDB, sourceModelName: string) {
  if (isSourceModel(run.modelName, sourceModelName)) {
    return {
      label: '源代码地址',
      url: run.originUrl ?? run.prUrl ?? null,
    };
  }

  return {
    label: '代码地址',
    url: run.prUrl,
  };
}

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function basenameOrFallback(path: string | null, fallback: string) {
  if (!path) {
    return fallback;
  }
  const normalized = path.replace(/\/+$/, '');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || fallback;
}

function parseAiReviewPayload(raw: string | null | undefined): AiReviewPayload | null {
  const text = trimToNull(raw);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<AiReviewPayload>;
    return {
      reviewNodeId: typeof parsed.reviewNodeId === 'string' ? parsed.reviewNodeId : null,
      modelRunId: parsed.modelRunId ?? null,
      modelName: typeof parsed.modelName === 'string' ? parsed.modelName : '',
      localPath: typeof parsed.localPath === 'string' ? parsed.localPath : '',
    };
  } catch {
    return null;
  }
}

function parseAiReviewResult(raw: string | null | undefined): AiReviewResult | null {
  const text = trimToNull(raw);
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Partial<AiReviewResult>;
    if (
      (parsed.reviewStatus !== 'pass' && parsed.reviewStatus !== 'warning') ||
      typeof parsed.modelName !== 'string'
    ) {
      return null;
    }
    return {
      reviewNodeId: typeof parsed.reviewNodeId === 'string' ? parsed.reviewNodeId : '',
      modelRunId: typeof parsed.modelRunId === 'string' ? parsed.modelRunId : '',
      modelName: parsed.modelName,
      reviewStatus: parsed.reviewStatus,
      reviewRound: typeof parsed.reviewRound === 'number' ? parsed.reviewRound : 0,
      reviewNotes: typeof parsed.reviewNotes === 'string' ? parsed.reviewNotes : '',
      nextPrompt: typeof parsed.nextPrompt === 'string' ? parsed.nextPrompt : '',
      isCompleted: typeof parsed.isCompleted === 'boolean' ? parsed.isCompleted : undefined,
      isSatisfied: typeof parsed.isSatisfied === 'boolean' ? parsed.isSatisfied : undefined,
      projectType: typeof parsed.projectType === 'string' ? parsed.projectType : undefined,
      changeScope: typeof parsed.changeScope === 'string' ? parsed.changeScope : undefined,
      keyLocations: typeof parsed.keyLocations === 'string' ? parsed.keyLocations : undefined,
      issues: Array.isArray(parsed.issues)
        ? parsed.issues
            .map((issue) => {
              const candidate = issue as unknown as Record<string, unknown>;
              return {
                title: typeof candidate.title === 'string' ? candidate.title : '',
                issueType: typeof candidate.issueType === 'string' ? candidate.issueType : '',
                reviewNotes: typeof candidate.reviewNotes === 'string' ? candidate.reviewNotes : '',
                nextPrompt: typeof candidate.nextPrompt === 'string' ? candidate.nextPrompt : '',
                keyLocations: typeof candidate.keyLocations === 'string' ? candidate.keyLocations : '',
              };
            })
            .filter((issue) => issue.title || issue.reviewNotes || issue.nextPrompt)
        : undefined,
    };
  } catch {
    return null;
  }
}

function extractAiReviewDetailsFromResult(
  result: AiReviewResult | null | undefined,
): AiReviewStructuredDetails | null {
  if (!result) {
    return null;
  }

  const details: AiReviewStructuredDetails = {
    isCompleted: typeof result.isCompleted === 'boolean' ? result.isCompleted : null,
    isSatisfied: typeof result.isSatisfied === 'boolean' ? result.isSatisfied : null,
    projectType: trimToNull(result.projectType),
    changeScope: trimToNull(result.changeScope),
    keyLocations: trimToNull(result.keyLocations),
  };

  return hasAiReviewDetails(details) ? details : null;
}

function extractAiReviewDetailsFromNode(
  node: AiReviewNodeFromDB | null | undefined,
): AiReviewStructuredDetails | null {
  if (!node) {
    return null;
  }
  const details: AiReviewStructuredDetails = {
    isCompleted: typeof node.isCompleted === 'boolean' ? node.isCompleted : null,
    isSatisfied: typeof node.isSatisfied === 'boolean' ? node.isSatisfied : null,
    projectType: trimToNull(node.projectType),
    changeScope: trimToNull(node.changeScope),
    keyLocations: trimToNull(node.keyLocations),
  };
  return hasAiReviewDetails(details) ? details : null;
}

function parseAiReviewProgressDetails(
  raw: string | null | undefined,
): AiReviewStructuredDetails | null {
  const text = trimToNull(raw);
  if (!text) {
    return null;
  }

  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(jsonStart)) as Partial<AiReviewResult>;
    return extractAiReviewDetailsFromResult({
      reviewNodeId: typeof parsed.reviewNodeId === 'string' ? parsed.reviewNodeId : '',
      modelRunId: typeof parsed.modelRunId === 'string' ? parsed.modelRunId : '',
      modelName: typeof parsed.modelName === 'string' ? parsed.modelName : '',
      reviewStatus: parsed.reviewStatus === 'pass' || parsed.reviewStatus === 'warning' ? parsed.reviewStatus : 'warning',
      reviewRound: typeof parsed.reviewRound === 'number' ? parsed.reviewRound : 0,
      reviewNotes: typeof parsed.reviewNotes === 'string' ? parsed.reviewNotes : '',
      nextPrompt: typeof parsed.nextPrompt === 'string' ? parsed.nextPrompt : '',
      isCompleted: typeof parsed.isCompleted === 'boolean' ? parsed.isCompleted : undefined,
      isSatisfied: typeof parsed.isSatisfied === 'boolean' ? parsed.isSatisfied : undefined,
      projectType: typeof parsed.projectType === 'string' ? parsed.projectType : undefined,
      changeScope: typeof parsed.changeScope === 'string' ? parsed.changeScope : undefined,
      keyLocations: typeof parsed.keyLocations === 'string' ? parsed.keyLocations : undefined,
      issues: undefined,
    });
  } catch {
    return null;
  }
}

function hasAiReviewDetails(details: AiReviewStructuredDetails) {
  return Boolean(
    details.projectType ||
      details.changeScope ||
      details.keyLocations ||
      details.isCompleted !== null ||
      details.isSatisfied !== null,
  );
}

function meaningfulAiReviewText(value: string | null | undefined) {
  const trimmed = trimToNull(value);
  if (!trimmed || trimmed === '无') {
    return null;
  }
  return trimmed;
}

function hasAiReviewNodeDraftChanges(
  node: AiReviewNodeFromDB,
  draft: AiReviewNodeDraft,
) {
  return (
    draft.title.trim() !== (node.title ?? '').trim() ||
    draft.issueType.trim() !== (node.issueType ?? '').trim() ||
    draft.promptText.trim() !== (node.promptText ?? '').trim() ||
    draft.reviewNotes.trim() !== (node.reviewNotes ?? '').trim()
  );
}

function buildAiReviewTreeNodes(nodes: AiReviewNodeFromDB[]) {
  if (nodes.length === 0) {
    return [] as Array<{ node: AiReviewNodeFromDB; depth: number; serial: number }>;
  }

  const childrenByParent = new Map<string | null, AiReviewNodeFromDB[]>();
  nodes.forEach((node) => {
    const key = node.parentId ?? null;
    const current = childrenByParent.get(key) ?? [];
    current.push(node);
    childrenByParent.set(key, current);
  });
  childrenByParent.forEach((value) => {
    value.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level;
      }
      if (a.sequence !== b.sequence) {
        return a.sequence - b.sequence;
      }
      return (a.createdAt ?? 0) - (b.createdAt ?? 0);
    });
  });

  const result: Array<{ node: AiReviewNodeFromDB; depth: number; serial: number }> = [];
  let serial = 1;
  const walk = (parentId: string | null, depth: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((node) => {
      result.push({ node, depth, serial });
      serial += 1;
      walk(node.id, depth + 1);
    });
  };
  walk(null, 1);
  return result;
}

function buildAiReviewKey(modelRunId: string | null | undefined, localPath: string | null | undefined) {
  const normalizedRunId = trimToNull(modelRunId);
  if (normalizedRunId) {
    return `run:${normalizedRunId}`;
  }
  const normalizedPath = trimToNull(localPath);
  if (normalizedPath) {
    return `path:${normalizedPath}`;
  }
  return null;
}

function deriveReviewStatusFromJob(entry: ParsedAiReviewJob) {
  if (entry.output?.reviewStatus === 'pass' || entry.output?.reviewStatus === 'warning') {
    return entry.output.reviewStatus;
  }
  if (entry.job.status === 'running' || entry.job.status === 'pending') {
    return 'running';
  }
  if (entry.job.status === 'error') {
    return 'warning';
  }
  return 'none';
}

function backgroundJobStatusPresentation(status: BackgroundJob['status']) {
  switch (status) {
    case 'pending':
      return { label: '排队中', tone: 'neutral' as const };
    case 'running':
      return { label: '执行中', tone: 'purple' as const };
    case 'done':
      return { label: '已完成', tone: 'success' as const };
    case 'error':
      return { label: '失败', tone: 'danger' as const };
    case 'cancelled':
      return { label: '已取消', tone: 'warning' as const };
    default:
      return { label: status, tone: 'neutral' as const };
  }
}

function formatAiReviewTimestamp(timestamp: number | null | undefined) {
  if (!timestamp) {
    return '未记录';
  }
  return new Date(timestamp * 1000).toLocaleString('zh-CN');
}

function reviewStatusPresentation(reviewStatus: string, reviewRound: number) {
  if (reviewStatus === 'running') {
    return {
      label: `复审中（第 ${reviewRound} 轮）`,
      icon: '↻',
      badgeCls: 'border border-violet-500/20 bg-violet-500/10 text-violet-300',
    };
  }
  if (reviewStatus === 'pass') {
    return {
      label: `复审通过（第 ${reviewRound} 轮）`,
      icon: '✓',
      badgeCls: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
    };
  }
  if (reviewStatus === 'warning') {
    return {
      label: `复审未通过（${reviewRound} 轮）`,
      icon: '⚠',
      badgeCls: 'border border-amber-500/30 bg-amber-500/10 text-amber-300',
    };
  }
  return { label: '', icon: '', badgeCls: '' };
}

function modelRunPresentation(status: string) {
  if (status === 'done') {
    return {
      label: '完成',
      icon: CheckCircle2,
      iconCls: 'text-emerald-400',
      badgeCls: 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-200',
    };
  }
  if (status === 'running') {
    return {
      label: '执行中',
      icon: PlayCircle,
      iconCls: 'text-amber-400',
      badgeCls: 'border border-amber-500/20 bg-amber-500/10 text-amber-200',
    };
  }
  if (status === 'error') {
    return {
      label: '异常',
      icon: X,
      iconCls: 'text-red-400',
      badgeCls: 'border border-red-500/20 bg-red-500/10 text-red-200',
    };
  }
  return {
    label: '待处理',
    icon: CircleDashed,
    iconCls: 'text-stone-400 dark:text-zinc-500',
    badgeCls: 'border border-stone-300 bg-stone-100 text-stone-700 dark:border-zinc-700/70 dark:bg-zinc-900 dark:text-zinc-300',
  };
}

// 自定义任务类型下拉
function TaskTypeSelect({
  value,
  options,
  disabled,
  selected: isSelectedCard,
  onChange,
  onClick,
}: {
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  selected: boolean;
  onChange: (value: string) => void;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e);
    if (disabled) return;
    if (!open && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const menuH = Math.min(options.length * 32 + 8, 240);
      if (spaceBelow >= menuH || spaceBelow >= 120) {
        setMenuStyle({ top: rect.bottom + 4, left: rect.left, minWidth: rect.width });
      } else {
        setMenuStyle({ bottom: window.innerHeight - rect.top + 4, left: rect.left, minWidth: rect.width });
      }
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node) && !menuRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={clsx(
          'flex w-full items-center justify-between gap-1 rounded-lg border px-2.5 py-1.5 text-[10px] font-medium outline-none transition',
          disabled
            ? 'cursor-default border-indigo-500/30 bg-indigo-500/10 text-indigo-400 opacity-70'
            : isSelectedCard
            ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'
            : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100 dark:border-zinc-700/70 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800',
        )}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className={clsx('h-3 w-3 shrink-0 transition-transform', open && 'rotate-180', isSelectedCard ? 'text-indigo-400' : 'text-stone-400 dark:text-zinc-500')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="fixed z-50 overflow-y-auto rounded-xl border border-zinc-700/80 bg-zinc-900 py-1 shadow-2xl"
            style={{ ...menuStyle, maxHeight: 240 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition',
                  opt.value === value
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-white',
                )}
              >
                {opt.value === value && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />}
                <span className={opt.value === value ? '' : 'ml-3.5'}>{opt.label}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Tooltip 组件
function Tooltip({
  content,
  children,
}: {
  content: string;
  children: React.ReactElement<{ onMouseEnter?: () => void; onMouseLeave?: () => void }>;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const childRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  const handleMouseEnter = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (childRef.current) {
        const rect = childRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + 8,
          left: rect.left + rect.width / 2,
        });
        setIsVisible(true);
      }
    }, 300);
  };

  const handleMouseLeave = () => {
    clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  const clonedChild = React.cloneElement(children, {
    ref: childRef as any,
    onMouseEnter: () => {
      handleMouseEnter();
      children.props.onMouseEnter?.();
    },
    onMouseLeave: () => {
      handleMouseLeave();
      children.props.onMouseLeave?.();
    },
  });

  return (
    <>
      {clonedChild}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="fixed z-50 max-w-xs rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              transform: 'translateX(-50%)',
            }}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
