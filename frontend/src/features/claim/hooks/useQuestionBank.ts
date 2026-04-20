import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteQuestionBankItem,
  importQuestionBankArchives,
  listQuestionBankItems,
  pickQuestionBankArchives,
  refreshQuestionBankItem,
  scanLocalQuestionBank,
  syncGitLabQuestionBank,
  normalizeManagedSourceFolders,
  type ImportLocalSourcesResult,
  type QuestionBankItem,
  type QuestionBankSyncResult,
  type NormalizeManagedSourceFoldersResult,
} from '../../../api/git';
import { useAppStore } from '../../../store';
import { parseQuestionBankProjectIds } from '../utils/claimUtils';

export type QuestionBankState = {
  questionBankItems: QuestionBankItem[];
  questionBankLoading: boolean;
  questionBankError: string;
  questionBankFilter: string;
  setQuestionBankFilter: (value: string) => void;
  filteredQuestionBankItems: QuestionBankItem[];
  selectableFilteredQuestionBankItems: QuestionBankItem[];
  selectedQuestionIds: number[];
  selectedQuestionIdSet: Set<number>;
  selectedQuestionBankItems: QuestionBankItem[];
  selectedQuestionCount: number;
  readyQuestionCount: number;
  allFilteredSelected: boolean;
  toggleQuestionSelection: (item: QuestionBankItem) => void;
  toggleSelectAllFiltered: () => void;
  selectAllFiltered: () => void;
  clearSelection: () => void;
  invertSelectionOnFiltered: () => void;
  reloadQuestionBankItems: () => Promise<void>;
  importingLocalSources: boolean;
  localImportError: string;
  localImportResult: ImportLocalSourcesResult | null;
  handleScanLocalQuestionBank: () => Promise<void>;
  handleImportArchivesViaPicker: () => Promise<void>;
  questionBankSyncing: boolean;
  questionBankSyncError: string;
  questionBankSyncResult: QuestionBankSyncResult | null;
  handleSyncGitLabQuestionBank: () => Promise<void>;
  refreshingQuestionId: number | null;
  handleRefreshQuestionBankItem: (questionId: number) => Promise<void>;
  deletingQuestionId: number | null;
  deleteError: string;
  handleDeleteQuestionBankItem: (questionId: number) => Promise<void>;
  configuredGitLabQuestionIds: number[];
  normalizeResult: NormalizeManagedSourceFoldersResult | null;
  normalizing: boolean;
  normalizeError: string;
  handleNormalize: () => Promise<void>;
};

export function useQuestionBank(projectId: string, questionBankProjectIdsRaw: string): QuestionBankState {
  const loadTasks = useAppStore((state) => state.loadTasks);

  const [questionBankItems, setQuestionBankItems] = useState<QuestionBankItem[]>([]);
  const [questionBankLoading, setQuestionBankLoading] = useState(false);
  const [questionBankError, setQuestionBankError] = useState('');
  const [questionBankFilter, setQuestionBankFilter] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([]);

  const [importingLocalSources, setImportingLocalSources] = useState(false);
  const [localImportError, setLocalImportError] = useState('');
  const [localImportResult, setLocalImportResult] = useState<ImportLocalSourcesResult | null>(null);

  const [questionBankSyncing, setQuestionBankSyncing] = useState(false);
  const [questionBankSyncError, setQuestionBankSyncError] = useState('');
  const [questionBankSyncResult, setQuestionBankSyncResult] = useState<QuestionBankSyncResult | null>(null);
  const [refreshingQuestionId, setRefreshingQuestionId] = useState<number | null>(null);

  const [normalizing, setNormalizing] = useState(false);
  const [normalizeError, setNormalizeError] = useState('');
  const [normalizeResult, setNormalizeResult] = useState<NormalizeManagedSourceFoldersResult | null>(null);

  const [deletingQuestionId, setDeletingQuestionId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const configuredGitLabQuestionIds = useMemo(
    () => parseQuestionBankProjectIds(questionBankProjectIdsRaw || ''),
    [questionBankProjectIdsRaw],
  );

  const reloadQuestionBankItems = useCallback(async () => {
    if (!projectId) {
      setQuestionBankItems([]);
      setSelectedQuestionIds([]);
      setQuestionBankError('');
      return;
    }
    setQuestionBankLoading(true);
    setQuestionBankError('');
    try {
      const items = await listQuestionBankItems(projectId);
      setQuestionBankItems(items);
      setSelectedQuestionIds((prev) =>
        prev.filter((questionId) =>
          items.some((item) => item.questionId === questionId && item.status === 'ready'),
        ),
      );
    } catch (error) {
      setQuestionBankError(error instanceof Error ? error.message : '加载题库失败');
    } finally {
      setQuestionBankLoading(false);
    }
  }, [projectId]);

  const handleNormalize = useCallback(async () => {
    setNormalizing(true);
    setNormalizeError('');
    try {
      const result = await normalizeManagedSourceFolders(projectId);
      setNormalizeResult(result);
      await loadTasks();
    } catch (error) {
      setNormalizeError(error instanceof Error ? error.message : '归一处理失败');
    } finally {
      setNormalizing(false);
    }
  }, [projectId, loadTasks]);

  const handleScanLocalQuestionBank = useCallback(async () => {
    setImportingLocalSources(true);
    setLocalImportError('');
    try {
      const result = await scanLocalQuestionBank(projectId);
      setLocalImportResult(result);
      await reloadQuestionBankItems();
      if (result.importedCount > 0) {
        await handleNormalize();
      }
    } catch (error) {
      setLocalImportError(error instanceof Error ? error.message : '本地题源扫描失败');
    } finally {
      setImportingLocalSources(false);
    }
  }, [projectId, reloadQuestionBankItems, handleNormalize]);

  const handleImportArchivesViaPicker = useCallback(async () => {
    setLocalImportError('');
    let paths: string[] = [];
    try {
      paths = await pickQuestionBankArchives();
    } catch (error) {
      setLocalImportError(error instanceof Error ? error.message : '选择压缩包失败');
      return;
    }
    if (paths.length === 0) return;

    setImportingLocalSources(true);
    try {
      const result = await importQuestionBankArchives(projectId, paths);
      setLocalImportResult(result);
      await reloadQuestionBankItems();
      if (result.importedCount > 0) {
        await handleNormalize();
      }
    } catch (error) {
      setLocalImportError(error instanceof Error ? error.message : '导入压缩包失败');
    } finally {
      setImportingLocalSources(false);
    }
  }, [projectId, reloadQuestionBankItems, handleNormalize]);

  const handleSyncGitLabQuestionBank = useCallback(async () => {
    setQuestionBankSyncing(true);
    setQuestionBankSyncError('');
    try {
      const result = await syncGitLabQuestionBank(projectId);
      setQuestionBankSyncResult(result);
      await reloadQuestionBankItems();
      if (result.syncedCount > 0) {
        await handleNormalize();
      }
    } catch (error) {
      setQuestionBankSyncError(error instanceof Error ? error.message : '同步 GitLab 题库失败');
    } finally {
      setQuestionBankSyncing(false);
    }
  }, [projectId, reloadQuestionBankItems, handleNormalize]);

  const handleRefreshQuestionBankItem = useCallback(async (questionId: number) => {
    setRefreshingQuestionId(questionId);
    setQuestionBankSyncError('');
    try {
      const result = await refreshQuestionBankItem(projectId, questionId);
      setQuestionBankSyncResult(result);
      await reloadQuestionBankItems();
    } catch (error) {
      setQuestionBankSyncError(error instanceof Error ? error.message : '刷新题库源码失败');
    } finally {
      setRefreshingQuestionId(null);
    }
  }, [projectId, reloadQuestionBankItems]);

  const handleDeleteQuestionBankItem = useCallback(async (questionId: number) => {
    if (!projectId) return;
    setDeletingQuestionId(questionId);
    setDeleteError('');
    try {
      await deleteQuestionBankItem(projectId, questionId);
      setSelectedQuestionIds((prev) => prev.filter((id) => id !== questionId));
      await reloadQuestionBankItems();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : '删除题库条目失败');
    } finally {
      setDeletingQuestionId(null);
    }
  }, [projectId, reloadQuestionBankItems]);

  // Load question bank on project change
  useEffect(() => {
    void reloadQuestionBankItems();
  }, [reloadQuestionBankItems]);

  // Auto-scan local sources on mount
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    const runImport = async () => {
      setImportingLocalSources(true);
      setLocalImportError('');
      try {
        const result = await scanLocalQuestionBank(projectId);
        if (cancelled) return;
        setLocalImportResult(result);
        await reloadQuestionBankItems();
        if (result.importedCount > 0) {
          await loadTasks();
        }
      } catch (error) {
        if (cancelled) return;
        setLocalImportError(error instanceof Error ? error.message : '本地题源扫描失败');
      } finally {
        if (!cancelled) setImportingLocalSources(false);
      }
    };

    void runImport();
    return () => { cancelled = true; };
  }, [projectId, reloadQuestionBankItems, loadTasks]);

  // Derived state
  const selectedQuestionIdSet = useMemo(() => new Set(selectedQuestionIds), [selectedQuestionIds]);

  const filteredQuestionBankItems = useMemo(() => {
    const keyword = questionBankFilter.trim().toLowerCase();
    if (!keyword) return questionBankItems;
    return questionBankItems.filter(
      (item) =>
        item.displayName.toLowerCase().includes(keyword) ||
        String(item.questionId).includes(keyword) ||
        item.sourceKind.toLowerCase().includes(keyword),
    );
  }, [questionBankFilter, questionBankItems]);

  const selectableFilteredQuestionBankItems = useMemo(
    () => filteredQuestionBankItems.filter((item) => item.status === 'ready'),
    [filteredQuestionBankItems],
  );

  const selectedQuestionBankItems = useMemo(
    () =>
      questionBankItems.filter(
        (item) => item.status === 'ready' && selectedQuestionIdSet.has(item.questionId),
      ),
    [questionBankItems, selectedQuestionIdSet],
  );

  const readyQuestionCount = useMemo(
    () => questionBankItems.filter((item) => item.status === 'ready').length,
    [questionBankItems],
  );

  const selectedQuestionCount = selectedQuestionBankItems.length;

  const allFilteredSelected =
    selectableFilteredQuestionBankItems.length > 0 &&
    selectableFilteredQuestionBankItems.every((item) => selectedQuestionIdSet.has(item.questionId));

  const toggleQuestionSelection = useCallback((item: QuestionBankItem) => {
    if (item.status !== 'ready') return;
    setSelectedQuestionIds((prev) =>
      prev.includes(item.questionId)
        ? prev.filter((value) => value !== item.questionId)
        : [...prev, item.questionId],
    );
  }, []);

  const toggleSelectAllFiltered = useCallback(() => {
    const visibleIds = selectableFilteredQuestionBankItems.map((item) => item.questionId);
    if (visibleIds.length === 0) return;
    setSelectedQuestionIds((prev) => {
      if (allFilteredSelected) {
        return prev.filter((questionId) => !visibleIds.includes(questionId));
      }
      return [...new Set([...prev, ...visibleIds])];
    });
  }, [selectableFilteredQuestionBankItems, allFilteredSelected]);

  const selectAllFiltered = useCallback(() => {
    const visibleIds = selectableFilteredQuestionBankItems.map((item) => item.questionId);
    if (visibleIds.length === 0) return;
    setSelectedQuestionIds((prev) => [...new Set([...prev, ...visibleIds])]);
  }, [selectableFilteredQuestionBankItems]);

  const clearSelection = useCallback(() => {
    setSelectedQuestionIds([]);
  }, []);

  const invertSelectionOnFiltered = useCallback(() => {
    const visibleIds = selectableFilteredQuestionBankItems.map((item) => item.questionId);
    if (visibleIds.length === 0) return;
    setSelectedQuestionIds((prev) => {
      const prevSet = new Set(prev);
      const outsideFiltered = prev.filter((id) => !visibleIds.includes(id));
      const invertedInsideFiltered = visibleIds.filter((id) => !prevSet.has(id));
      return [...outsideFiltered, ...invertedInsideFiltered];
    });
  }, [selectableFilteredQuestionBankItems]);

  return {
    questionBankItems,
    questionBankLoading,
    questionBankError,
    questionBankFilter,
    setQuestionBankFilter,
    filteredQuestionBankItems,
    selectableFilteredQuestionBankItems,
    selectedQuestionIds,
    selectedQuestionIdSet,
    selectedQuestionBankItems,
    selectedQuestionCount,
    readyQuestionCount,
    allFilteredSelected,
    toggleQuestionSelection,
    toggleSelectAllFiltered,
    selectAllFiltered,
    clearSelection,
    invertSelectionOnFiltered,
    reloadQuestionBankItems,
    importingLocalSources,
    localImportError,
    localImportResult,
    handleScanLocalQuestionBank,
    handleImportArchivesViaPicker,
    questionBankSyncing,
    questionBankSyncError,
    questionBankSyncResult,
    handleSyncGitLabQuestionBank,
    refreshingQuestionId,
    handleRefreshQuestionBankItem,
    deletingQuestionId,
    deleteError,
    handleDeleteQuestionBankItem,
    configuredGitLabQuestionIds,
    normalizeResult,
    normalizing,
    normalizeError,
    handleNormalize,
  };
}
