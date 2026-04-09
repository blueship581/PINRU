export type TaskType = string;

export type TaskTypeQuotas = Record<string, number | undefined>;

export type TaskTypeSource = {
  taskTypes?: string | null;
  taskTypeQuotas?: string | null;
};

export const DEFAULT_TASK_TYPE = '未归类';

export const DEFAULT_TASK_TYPES = [
  DEFAULT_TASK_TYPE,
  'Bug修复',
  '代码生成',
  'Feature迭代',
  '代码理解',
  '代码重构',
  '工程化',
  '代码测试',
] as const;

const TASK_TYPE_ALIASES: Record<string, string> = {
  uncategorized: DEFAULT_TASK_TYPE,
  unclassified: DEFAULT_TASK_TYPE,
  '未分类': DEFAULT_TASK_TYPE,
  '未归类': DEFAULT_TASK_TYPE,
  bugfix: 'Bug修复',
  'bug修复': 'Bug修复',
  '缺陷修复': 'Bug修复',
  'bug修復': 'Bug修复',
  '代码生成': '代码生成',
  feature: 'Feature迭代',
  'feature迭代': 'Feature迭代',
  '功能开发': 'Feature迭代',
  '代码理解': '代码理解',
  refactor: '代码重构',
  '代码重构': '代码重构',
  perf: '性能优化',
  '性能优化': '性能优化',
  '工程化': '工程化',
  test: '代码测试',
  '测试': '代码测试',
  '测试补全': '代码测试',
  '代码测试': '代码测试',
};

const TASK_TYPE_LABELS: Record<string, string> = {
  Bug修复: 'Bug 修复',
  Feature迭代: 'Feature 迭代',
};

const TASK_TYPE_TONES = [
  {
    dot: 'bg-violet-500',
    badge: 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-500/20',
    soft: 'bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-200 dark:border-violet-500/30',
  },
  {
    dot: 'bg-rose-500',
    badge: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/20',
    soft: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30',
  },
  {
    dot: 'bg-amber-500',
    badge: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/20',
    soft: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30',
  },
  {
    dot: 'bg-sky-500',
    badge: 'bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-500/20',
    soft: 'bg-sky-100 dark:bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/30',
  },
  {
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/20',
    soft: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30',
  },
  {
    dot: 'bg-fuchsia-500',
    badge: 'bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-500/20',
    soft: 'bg-fuchsia-100 dark:bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-400 border-fuchsia-200 dark:border-fuchsia-500/30',
  },
  {
    dot: 'bg-cyan-500',
    badge: 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-500/20',
    soft: 'bg-cyan-100 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30',
  },
  {
    dot: 'bg-orange-500',
    badge: 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-500/20',
    soft: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/30',
  },
] as const;

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function parseTaskTypeList(taskTypesStr?: string | null): string[] {
  const trimmed = taskTypesStr?.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }
    } catch {
      return trimmed.split(/[,\n]/);
    }
  }

  return trimmed.split(/[,\n]/);
}

function taskTypeIdentity(value: string) {
  return normalizeTaskTypeName(value).toLowerCase();
}

export function normalizeTaskTypeName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const alias = TASK_TYPE_ALIASES[normalizeLookupKey(trimmed)];
  return alias ?? trimmed;
}

export function getTaskTypeDisplayLabel(value: string) {
  const normalized = normalizeTaskTypeName(value);
  return TASK_TYPE_LABELS[normalized] ?? normalized;
}

export function dedupeTaskTypes(taskTypes: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const taskType of taskTypes) {
    const nextName = normalizeTaskTypeName(taskType);
    if (!nextName) continue;

    const identity = nextName.toLowerCase();
    if (seen.has(identity)) continue;

    seen.add(identity);
    normalized.push(nextName);
  }

  return normalized;
}

export function parseTaskTypeQuotas(quotasStr?: string | null): TaskTypeQuotas {
  const trimmed = quotasStr?.trim();
  if (!trimmed || trimmed === '{}') return {};

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const normalized: TaskTypeQuotas = {};

    for (const [taskType, value] of Object.entries(parsed)) {
      const normalizedType = normalizeTaskTypeName(taskType);
      const parsedValue = Math.floor(Number(value));
      if (!normalizedType || !Number.isFinite(parsedValue)) continue;
      normalized[normalizedType] = parsedValue;
    }

    return normalized;
  } catch {
    return {};
  }
}

export function serializeTaskTypeQuotas(
  quotas: TaskTypeQuotas,
  allowedTaskTypes: string[] = [],
) {
  const allowed = new Set(dedupeTaskTypes(allowedTaskTypes).map((taskType) => taskType.toLowerCase()));
  const filtered: Record<string, number> = {};

  for (const [taskType, value] of Object.entries(quotas)) {
    const normalizedType = normalizeTaskTypeName(taskType);
    const parsedValue = Math.floor(Number(value));

    if (!normalizedType || !Number.isFinite(parsedValue) || parsedValue < 0) continue;
    if (allowed.size > 0 && !allowed.has(normalizedType.toLowerCase())) continue;

    filtered[normalizedType] = parsedValue;
  }

  return JSON.stringify(filtered);
}

export function parseProjectTaskTypes(
  taskTypesStr?: string | null,
  quotasStr?: string | null,
  fallbackTaskTypes: string[] = [],
) {
  const configuredTypes = parseTaskTypeList(taskTypesStr);
  const quotaTypes = Object.keys(parseTaskTypeQuotas(quotasStr));
  const merged = dedupeTaskTypes([...configuredTypes, ...quotaTypes, ...fallbackTaskTypes]);
  if (merged.length === 0) {
    return [...DEFAULT_TASK_TYPES];
  }

  return dedupeTaskTypes([DEFAULT_TASK_TYPE, ...merged]);
}

export function buildProjectTaskTypes(
  source?: TaskTypeSource | null,
  fallbackTaskTypes: string[] = [],
) {
  return parseProjectTaskTypes(source?.taskTypes, source?.taskTypeQuotas, fallbackTaskTypes);
}

export function serializeProjectTaskTypes(taskTypes: string[]) {
  return JSON.stringify(parseProjectTaskTypes(JSON.stringify(taskTypes)));
}

export function getTaskTypeQuotaValue(quotas: TaskTypeQuotas, taskType: string) {
  const rawValue = getTaskTypeQuotaRawValue(quotas, taskType);
  if (rawValue === null) return null;

  return Math.max(0, rawValue);
}

export function getTaskTypeQuotaRawValue(quotas: TaskTypeQuotas, taskType: string) {
  const normalizedType = normalizeTaskTypeName(taskType);
  if (!normalizedType) return null;

  const rawValue = quotas[normalizedType];
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) return null;

  return Math.floor(rawValue);
}

function hashTaskType(value: string) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

export function getTaskTypePresentation(value: string) {
  const normalized = normalizeTaskTypeName(value) || DEFAULT_TASK_TYPE;
  const tone = TASK_TYPE_TONES[hashTaskType(taskTypeIdentity(normalized)) % TASK_TYPE_TONES.length];

  return {
    value: normalized,
    label: getTaskTypeDisplayLabel(normalized),
    ...tone,
  };
}
