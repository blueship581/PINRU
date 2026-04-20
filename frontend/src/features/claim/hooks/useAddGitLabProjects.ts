import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getProjects,
  updateProject,
  type ProjectConfig,
} from '../../../api/config';
import {
  fetchConfiguredGitLabProjects,
  type GitLabProject,
  type GitLabProjectLookupResult,
} from '../../../api/git';
import { useAppStore } from '../../../store';
import {
  buildProjectRef,
  parseProjectIds,
  parseQuestionBankProjectIds,
} from '../utils/claimUtils';

export type LookupStatus = 'existing' | 'ok' | 'error';

export interface IdLookupRow {
  rawId: string;
  numId: number;
  status: LookupStatus;
  projectName?: string;
  errorMsg?: string;
  excluded: boolean;
}

export type AdderPhase = 'idle' | 'verifying' | 'verified' | 'saving' | 'done';

export interface UseAddGitLabProjectsState {
  inputText: string;
  setInputText: (value: string) => void;
  parsedTokens: string[];
  hasInvalidChars: boolean;
  phase: AdderPhase;
  rows: IdLookupRow[];
  verifyError: string;
  saveError: string;
  addableCount: number;
  addedCount: number;
  configuredIds: number[];
  configuredProjects: Map<number, GitLabProject>;
  configuredLookupLoading: boolean;
  configuredLookupError: string;
  removingId: number | null;
  handleVerify: () => Promise<void>;
  handleConfirmAdd: () => Promise<void>;
  handleExcludeRow: (numId: number) => void;
  handleReset: () => void;
  handleRemoveConfigured: (numId: number) => Promise<void>;
  reloadConfiguredProjects: () => Promise<void>;
}

function extractPrimaryNumericId(projectRef: string, fallback: number): number {
  const match = projectRef.match(/(\d+)(?!.*\d)/);
  if (!match) return fallback;
  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function useAddGitLabProjects(
  activeProject: ProjectConfig | null,
): UseAddGitLabProjectsState {
  const setActiveProject = useAppStore((state) => state.setActiveProject);

  const projectId = activeProject?.id ?? '';
  const questionBankRaw = activeProject?.questionBankProjectIds ?? '';

  const configuredIds = useMemo(
    () => parseQuestionBankProjectIds(questionBankRaw),
    [questionBankRaw],
  );

  const [inputText, setInputText] = useState('');
  const [phase, setPhase] = useState<AdderPhase>('idle');
  const [rows, setRows] = useState<IdLookupRow[]>([]);
  const [verifyError, setVerifyError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [addedCount, setAddedCount] = useState(0);

  const [configuredProjects, setConfiguredProjects] = useState<Map<number, GitLabProject>>(
    new Map(),
  );
  const [configuredLookupLoading, setConfiguredLookupLoading] = useState(false);
  const [configuredLookupError, setConfiguredLookupError] = useState('');
  const [removingId, setRemovingId] = useState<number | null>(null);

  const parsedTokens = useMemo(() => parseProjectIds(inputText), [inputText]);

  const hasInvalidChars = useMemo(() => {
    if (!inputText.trim()) return false;
    const rawTokens = inputText
      .split(/[\s,，、;；]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    return rawTokens.some((token) => !/^\d+$/.test(token));
  }, [inputText]);

  const handleReset = useCallback(() => {
    setInputText('');
    setRows([]);
    setPhase('idle');
    setVerifyError('');
    setSaveError('');
    setAddedCount(0);
  }, []);

  useEffect(() => {
    handleReset();
  }, [projectId, handleReset]);

  const reloadConfiguredProjects = useCallback(async () => {
    if (configuredIds.length === 0) {
      setConfiguredProjects(new Map());
      setConfiguredLookupError('');
      return;
    }
    setConfiguredLookupLoading(true);
    setConfiguredLookupError('');
    try {
      const refs = configuredIds.map((id) => buildProjectRef(String(id)));
      const results = await fetchConfiguredGitLabProjects(refs);
      const next = new Map<number, GitLabProject>();
      results.forEach((result, index) => {
        const fallbackId = configuredIds[index];
        if (result.project) {
          const key = extractPrimaryNumericId(result.projectRef, fallbackId);
          next.set(key, result.project);
        }
      });
      setConfiguredProjects(next);
    } catch (error) {
      setConfiguredLookupError(
        error instanceof Error ? error.message : '加载已配置题目信息失败',
      );
    } finally {
      setConfiguredLookupLoading(false);
    }
  }, [configuredIds]);

  useEffect(() => {
    void reloadConfiguredProjects();
  }, [reloadConfiguredProjects]);

  const handleVerify = useCallback(async () => {
    const tokens = parseProjectIds(inputText);
    if (tokens.length === 0) {
      setRows([]);
      setVerifyError('请先输入至少一个有效的数字 ID');
      return;
    }

    setPhase('verifying');
    setVerifyError('');
    setSaveError('');
    setAddedCount(0);

    const existingSet = new Set(configuredIds.map((id) => String(id)));
    const existingRows: IdLookupRow[] = [];
    const toCheck: string[] = [];

    for (const token of tokens) {
      if (existingSet.has(token)) {
        existingRows.push({
          rawId: token,
          numId: Number.parseInt(token, 10),
          status: 'existing',
          excluded: false,
        });
      } else {
        toCheck.push(token);
      }
    }

    let checkedRows: IdLookupRow[] = [];
    if (toCheck.length > 0) {
      try {
        const refs = toCheck.map((id) => buildProjectRef(id));
        const results: GitLabProjectLookupResult[] = await fetchConfiguredGitLabProjects(refs);
        checkedRows = results.map((result, index) => {
          const rawId = toCheck[index];
          const numId = Number.parseInt(rawId, 10);
          if (result.project) {
            return {
              rawId,
              numId,
              status: 'ok',
              projectName: result.project.name,
              excluded: false,
            };
          }
          return {
            rawId,
            numId,
            status: 'error',
            errorMsg: result.error?.trim() || '无法访问该项目',
            excluded: false,
          };
        });
      } catch (error) {
        setPhase('idle');
        setVerifyError(
          error instanceof Error ? error.message : 'GitLab 项目校验失败，请检查凭据与网络',
        );
        return;
      }
    }

    const ordered: IdLookupRow[] = [];
    const existingMap = new Map(existingRows.map((row) => [row.rawId, row]));
    const checkedMap = new Map(checkedRows.map((row) => [row.rawId, row]));
    for (const token of tokens) {
      const row = existingMap.get(token) ?? checkedMap.get(token);
      if (row) ordered.push(row);
    }
    setRows(ordered);
    setPhase('verified');
  }, [inputText, configuredIds]);

  const handleExcludeRow = useCallback((numId: number) => {
    setRows((prev) =>
      prev.map((row) => (row.numId === numId ? { ...row, excluded: true } : row)),
    );
  }, []);

  const addableCount = useMemo(
    () => rows.filter((row) => row.status === 'ok' && !row.excluded).length,
    [rows],
  );

  const handleConfirmAdd = useCallback(async () => {
    if (!activeProject) return;
    const addIds = rows
      .filter((row) => row.status === 'ok' && !row.excluded)
      .map((row) => row.numId);
    if (addIds.length === 0) {
      setSaveError('没有可加入的题目');
      return;
    }

    setPhase('saving');
    setSaveError('');
    try {
      const merged = [...new Set([...configuredIds, ...addIds])];
      const nextProject: ProjectConfig = {
        ...activeProject,
        questionBankProjectIds: JSON.stringify(merged),
      };
      await updateProject(nextProject);

      const refreshed = await getProjects();
      const updated = refreshed.find((p) => p.id === activeProject.id) ?? nextProject;
      setActiveProject(updated);

      setAddedCount(addIds.length);
      setPhase('done');
    } catch (error) {
      setPhase('verified');
      setSaveError(error instanceof Error ? error.message : '保存失败，请稍后重试');
    }
  }, [activeProject, rows, configuredIds, setActiveProject]);

  const handleRemoveConfigured = useCallback(
    async (numId: number) => {
      if (!activeProject) return;
      setRemovingId(numId);
      setConfiguredLookupError('');
      try {
        const nextIds = configuredIds.filter((id) => id !== numId);
        const nextProject: ProjectConfig = {
          ...activeProject,
          questionBankProjectIds: JSON.stringify(nextIds),
        };
        await updateProject(nextProject);
        const refreshed = await getProjects();
        const updated = refreshed.find((p) => p.id === activeProject.id) ?? nextProject;
        setActiveProject(updated);
      } catch (error) {
        setConfiguredLookupError(
          error instanceof Error ? error.message : '移除失败，请稍后重试',
        );
      } finally {
        setRemovingId(null);
      }
    },
    [activeProject, configuredIds, setActiveProject],
  );

  return {
    inputText,
    setInputText,
    parsedTokens,
    hasInvalidChars,
    phase,
    rows,
    verifyError,
    saveError,
    addableCount,
    addedCount,
    configuredIds,
    configuredProjects,
    configuredLookupLoading,
    configuredLookupError,
    removingId,
    handleVerify,
    handleConfirmAdd,
    handleExcludeRow,
    handleReset,
    handleRemoveConfigured,
    reloadConfiguredProjects,
  };
}
