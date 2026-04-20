import { FileArchive, FolderSearch, GitBranch, Info, Loader2, RefreshCw, Scale } from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import type {
  ImportLocalSourcesResult,
  NormalizeManagedSourceFoldersResult,
  QuestionBankSyncResult,
} from '../../../api/git';

type ActionState = 'idle' | 'running' | 'ok' | 'warn' | 'error';

const STATE_DOT: Record<ActionState, string> = {
  idle: 'bg-stone-300 dark:bg-stone-600',
  running: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-500',
  warn: 'bg-orange-400',
  error: 'bg-red-500',
};

function QuickAction({
  icon: Icon,
  label,
  explain,
  state,
  disabled,
  onClick,
  meta,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  explain: string;
  state: ActionState;
  disabled?: boolean;
  onClick: () => void;
  meta?: ReactNode;
}) {
  const running = state === 'running';
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="inline-flex items-center">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled || running}
          className="group inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white/80 pl-2.5 pr-3 py-1.5 text-[12px] font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700/70 dark:bg-stone-900/50 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800/60 dark:hover:text-stone-100 cursor-default"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          ) : (
            <Icon className="h-3.5 w-3.5 text-stone-400 group-hover:text-stone-600 dark:text-stone-500 dark:group-hover:text-stone-300" />
          )}
          <span>{label}</span>
          <span className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${STATE_DOT[state]}`} aria-hidden />
        </button>
        <span
          tabIndex={0}
          role="note"
          aria-label={`${label}：${explain}`}
          className="group/tip relative ml-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:bg-stone-100 focus:text-stone-600 focus:outline-none dark:text-stone-500 dark:hover:bg-stone-800/60 dark:hover:text-stone-300 dark:focus:bg-stone-800/60 dark:focus:text-stone-300 cursor-help"
        >
          <Info className="h-3.5 w-3.5" />
          <span
            role="tooltip"
            className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-[240px] -translate-x-1/2 translate-y-1 rounded-md bg-stone-900 px-2.5 py-1.5 text-[11px] font-normal leading-snug text-stone-100 opacity-0 shadow-lg transition-[opacity,transform] duration-75 group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-focus/tip:translate-y-0 group-focus/tip:opacity-100 dark:bg-stone-100 dark:text-stone-900"
          >
            {explain}
            <span
              aria-hidden
              className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-900 dark:border-t-stone-100"
            />
          </span>
        </span>
      </div>
      {meta && (
        <div className="pl-2.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
          {meta}
        </div>
      )}
    </div>
  );
}

export function SyncToolbar({
  importingLocalSources,
  localImportError,
  localImportResult,
  onScan,
  onImportArchives,
  syncing,
  syncError,
  syncResult,
  configuredGitLabQuestionIds,
  onSync,
  normalizing,
  normalizeError,
  normalizeResult,
  onNormalize,
}: {
  importingLocalSources: boolean;
  localImportError: string;
  localImportResult: ImportLocalSourcesResult | null;
  onScan: () => void;
  onImportArchives: () => void;
  syncing: boolean;
  syncError: string;
  syncResult: QuestionBankSyncResult | null;
  configuredGitLabQuestionIds: number[];
  onSync: () => void;
  normalizing: boolean;
  normalizeError: string;
  normalizeResult: NormalizeManagedSourceFoldersResult | null;
  onNormalize: () => void;
}) {
  const localState: ActionState = importingLocalSources
    ? 'running'
    : localImportError
      ? 'error'
      : localImportResult
        ? localImportResult.errorCount > 0
          ? 'warn'
          : localImportResult.importedCount > 0 || localImportResult.removedCount > 0
            ? 'ok'
            : 'idle'
        : 'idle';

  const gitlabState: ActionState = syncing
    ? 'running'
    : syncError
      ? 'error'
      : syncResult
        ? syncResult.errorCount > 0
          ? 'warn'
          : syncResult.syncedCount > 0
            ? 'ok'
            : 'idle'
        : 'idle';

  const normalizeState: ActionState = normalizing
    ? 'running'
    : normalizeError
      ? 'error'
      : normalizeResult
        ? normalizeResult.errorCount > 0
          ? 'warn'
          : normalizeResult.renamedCount + normalizeResult.updatedCount > 0
            ? 'ok'
            : 'idle'
        : 'idle';

  const gitlabConfigured = configuredGitLabQuestionIds.length > 0;
  const gitlabExplain = gitlabConfigured
    ? `从 ${configuredGitLabQuestionIds.length} 个已配置的 GitLab 题目 ID 拉取最新题库到本地`
    : '未配置题目 ID，请在下方「GitLab 题库」卡片中添加';

  const localMeta = localImportError ? (
    <span className="text-red-500">{localImportError}</span>
  ) : localImportResult ? (
    <span>
      入库 <b className="text-stone-700 dark:text-stone-300">{localImportResult.importedCount}</b>
      <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
      跳过 {localImportResult.skippedCount}
      {localImportResult.removedCount > 0 && (
        <>
          <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
          清理 {localImportResult.removedCount}
        </>
      )}
      {localImportResult.errorCount > 0 && (
        <>
          <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
          <span className="text-red-500">错误 {localImportResult.errorCount}</span>
        </>
      )}
    </span>
  ) : null;

  const gitlabMeta = syncError ? (
    <span className="text-red-500">{syncError}</span>
  ) : syncResult ? (
    <span>
      同步 <b className="text-stone-700 dark:text-stone-300">{syncResult.syncedCount}</b>
      <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
      跳过 {syncResult.skippedCount}
      {syncResult.errorCount > 0 && (
        <>
          <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
          <span className="text-red-500">错误 {syncResult.errorCount}</span>
        </>
      )}
    </span>
  ) : gitlabConfigured ? (
    <span>已配置 {configuredGitLabQuestionIds.length} 个题目 ID</span>
  ) : null;

  const normalizeMeta = normalizeError ? (
    <span className="text-red-500">{normalizeError}</span>
  ) : normalizeResult ? (
    <span>
      扫描 {normalizeResult.totalTasks}
      <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
      重命名 {normalizeResult.renamedCount}
      <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
      补 Git {normalizeResult.gitInitializedCount}
      {normalizeResult.errorCount > 0 && (
        <>
          <span className="mx-1 text-stone-300 dark:text-stone-700">·</span>
          <span className="text-red-500">错误 {normalizeResult.errorCount}</span>
        </>
      )}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white/60 px-4 py-3.5 dark:border-stone-800 dark:bg-stone-900/40 md:flex-row md:items-start md:justify-between">
      {/* 主操作：导入压缩包（需要用户选文件，保留为醒目 CTA） */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          <FileArchive className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
              导入压缩包
            </span>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATE_DOT[localState]}`} aria-hidden />
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
            选择本地 .zip / .7z 文件拷入项目并入库
          </p>
          <button
            type="button"
            onClick={onImportArchives}
            disabled={importingLocalSources}
            className="mt-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-stone-900 bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 cursor-default"
          >
            {importingLocalSources && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {importingLocalSources ? '导入中' : '选择压缩包'}
          </button>
        </div>
      </div>

      {/* 次级操作：不需要输入参数，做成一排精致的小胶囊按钮 */}
      <div className="flex flex-col gap-2.5 md:items-end">
        <div className="flex flex-wrap gap-2 md:justify-end">
          <QuickAction
            icon={FolderSearch}
            label="重新扫描"
            explain="扫描项目根目录下已存在的压缩包与源码目录，将未入库的题目补入本地题库"
            state={localState}
            onClick={onScan}
          />
          <QuickAction
            icon={GitBranch}
            label="同步 GitLab"
            explain={gitlabExplain}
            state={gitlabState}
            disabled={!gitlabConfigured}
            onClick={onSync}
          />
          <QuickAction
            icon={Scale}
            label="归一"
            explain="按统一命名规则重命名任务/源码目录，并为缺失的目录补齐 .git 仓库"
            state={normalizeState}
            onClick={onNormalize}
          />
        </div>
        {(localMeta || gitlabMeta || normalizeMeta) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] leading-snug text-stone-500 dark:text-stone-400 md:justify-end">
            {localMeta && <span>扫描 · {localMeta}</span>}
            {gitlabMeta && <span>GitLab · {gitlabMeta}</span>}
            {normalizeMeta && <span>归一 · {normalizeMeta}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// 旧的 LocalScanCard/GitLabSyncCard/NormalizeCard 已被 SyncToolbar 取代，为避免其它模块直接引用时的破坏性改动，此处仅导出新组件。
export { RefreshCw };
