import type { ExtractTaskSessionCandidate, ModelRunFromDB } from '../../api/task';

export type SessionModelOption = {
  modelName: string;
  localPath: string | null;
};

function isOriginModel(name: string) {
  return name.trim().toUpperCase() === 'ORIGIN';
}

function isSourceModel(name: string, sourceModelName: string) {
  return name.trim().toUpperCase() === sourceModelName.trim().toUpperCase();
}

export function matchKindLabel(matchKind: string) {
  if (matchKind === 'exact') return '完全匹配';
  if (matchKind === 'child') return '项目子目录';
  if (matchKind === 'parent') return '项目父目录';
  if (matchKind === 'sibling') return '同项目模型目录';
  if (matchKind === 'peer_model') return '同项目跨目录模型';
  if (matchKind === 'peer_task') return '同项目跨目录';
  return matchKind || '未知';
}

export function buildSessionModelOptions(
  modelRuns: ModelRunFromDB[] | null | undefined,
  sourceModelName: string,
): SessionModelOption[] {
  const normalizedModelRuns = Array.isArray(modelRuns) ? modelRuns : [];
  const executionRuns = normalizedModelRuns.filter(
    (run) => !isOriginModel(run.modelName) && !isSourceModel(run.modelName, sourceModelName),
  );
  const runs = executionRuns.length > 0 ? executionRuns : normalizedModelRuns;
  return runs
    .filter((run) => Boolean(run.localPath?.trim()))
    .map((run) => ({
      modelName: run.modelName,
      localPath: run.localPath,
    }));
}

export function filterCandidatesForModel(
  candidates: ExtractTaskSessionCandidate[] | null | undefined,
  modelRuns: ModelRunFromDB[] | null | undefined,
  modelName: string,
): ExtractTaskSessionCandidate[] {
  const normalizedCandidates = Array.isArray(candidates) ? candidates : [];
  const normalizedModelRuns = Array.isArray(modelRuns) ? modelRuns : [];
  if (!modelName.trim()) {
    return normalizedCandidates;
  }

  const targetRun = normalizedModelRuns.find((run) => run.modelName === modelName);
  if (!targetRun?.localPath?.trim()) {
    return normalizedCandidates;
  }

  return normalizedCandidates.filter((candidate) => candidateMatchesModelRun(candidate, targetRun));
}

export function resolveCandidateModelName(
  candidate: ExtractTaskSessionCandidate,
  modelRuns: ModelRunFromDB[],
): string | null {
  const matchedRun = modelRuns.find((run) => candidateMatchesModelRun(candidate, run));
  return matchedRun?.modelName ?? null;
}

export function candidateMatchesModelRun(
  candidate: ExtractTaskSessionCandidate,
  modelRun: Pick<ModelRunFromDB, 'localPath'>,
): boolean {
  const modelPath = modelRun.localPath?.trim();
  if (!modelPath) {
    return false;
  }

  return [candidate.matchedPath, candidate.workspacePath].some((pathValue) =>
    pathMatchesModelPath(pathValue, modelPath),
  );
}

export function pathMatchesModelPath(candidatePath: string, modelPath: string): boolean {
  const normalizedCandidate = normalizeComparablePath(candidatePath);
  const normalizedModel = normalizeComparablePath(modelPath);
  if (!normalizedCandidate || !normalizedModel) {
    return false;
  }

  if (
    normalizedCandidate === normalizedModel ||
    isSameOrChildComparablePath(normalizedCandidate, normalizedModel) ||
    isSameOrChildComparablePath(normalizedModel, normalizedCandidate)
  ) {
    return true;
  }

  return (
    isSiblingModelComparablePath(normalizedCandidate, normalizedModel) ||
    isPeerModelComparablePath(normalizedCandidate, normalizedModel) ||
    isPeerTaskComparablePath(normalizedCandidate, normalizedModel)
  );
}

function isSameOrChildComparablePath(pathValue: string, maybeParent: string): boolean {
  return pathValue === maybeParent || pathValue.startsWith(`${maybeParent}/`);
}

function normalizeComparablePath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function baseName(pathValue: string): string {
  const normalized = normalizeComparablePath(pathValue);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function dirName(pathValue: string): string {
  const normalized = normalizeComparablePath(pathValue);
  if (!normalized) {
    return '';
  }
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return '';
  }
  return `/${parts.slice(0, -1).join('/')}`;
}

function extractTaskLabelToken(pathValue: string): string {
  const normalized = normalizeComparablePath(pathValue);
  if (!normalized) {
    return '';
  }

  const parts = normalized.split('/').filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const match = parts[index].match(/^(label-\d+)/i);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return '';
}

function isSiblingModelComparablePath(candidatePath: string, modelPath: string): boolean {
  if (baseName(candidatePath) !== baseName(modelPath)) {
    return false;
  }

  const candidateToken = extractTaskLabelToken(candidatePath);
  const modelToken = extractTaskLabelToken(modelPath);
  if (!candidateToken || candidateToken !== modelToken) {
    return false;
  }

  const candidateParent = dirName(dirName(candidatePath));
  const modelParent = dirName(dirName(modelPath));
  return Boolean(candidateParent) && candidateParent === modelParent;
}

function isPeerModelComparablePath(candidatePath: string, modelPath: string): boolean {
  const candidateToken = extractTaskLabelToken(candidatePath);
  const modelToken = extractTaskLabelToken(modelPath);
  return Boolean(candidateToken) && candidateToken === modelToken && baseName(candidatePath) === baseName(modelPath);
}

function isPeerTaskComparablePath(candidatePath: string, modelPath: string): boolean {
  const candidateToken = extractTaskLabelToken(candidatePath);
  const modelToken = extractTaskLabelToken(modelPath);
  if (!candidateToken || candidateToken !== modelToken) {
    return false;
  }

  return (
    baseName(candidatePath).startsWith(candidateToken) ||
    baseName(modelPath).startsWith(modelToken)
  );
}
