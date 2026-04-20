import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  MinusCircle,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { ProjectConfig } from '../../../api/config';
import { useAddGitLabProjects, type IdLookupRow } from '../hooks/useAddGitLabProjects';

interface Props {
  activeProject: ProjectConfig | null;
  onSync: () => void | Promise<void>;
  syncing: boolean;
}

const badgeByStatus: Record<IdLookupRow['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  existing: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  error: 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400',
};

const labelByStatus: Record<IdLookupRow['status'], string> = {
  ok: '可加入',
  existing: '已配置',
  error: '不可达',
};

function StatusIcon({ status }: { status: IdLookupRow['status'] }) {
  if (status === 'ok') {
    return <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />;
  }
  if (status === 'existing') {
    return <MinusCircle className="h-3.5 w-3.5 text-stone-400" aria-hidden />;
  }
  return <XCircle className="h-3.5 w-3.5 text-red-500" aria-hidden />;
}

export default function GitLabProjectAdder({
  activeProject,
  onSync,
  syncing,
}: Props) {
  const adder = useAddGitLabProjects(activeProject);
  const [expanded, setExpanded] = useState(false);

  if (!activeProject) return null;

  const {
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
  } = adder;

  const verifying = phase === 'verifying';
  const saving = phase === 'saving';
  const showResults = phase === 'verified' && rows.length > 0;
  const showDone = phase === 'done';
  const visibleRows = showResults ? rows.filter((row) => !row.excluded) : [];
  const summaryOk = visibleRows.filter((r) => r.status === 'ok').length;
  const summaryExisting = visibleRows.filter((r) => r.status === 'existing').length;
  const summaryError = visibleRows.filter((r) => r.status === 'error').length;

  const verifyDisabled = verifying || saving || parsedTokens.length === 0;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white/60 dark:border-stone-800 dark:bg-stone-900/40">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-left cursor-default"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <GitBranch className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-stone-900 dark:text-stone-100">
                GitLab 题库
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                已配置 {configuredIds.length}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-stone-500 dark:text-stone-400">
              批量加入 GitLab 题目 ID，自动去重并校验可达性
            </p>
          </div>
        </div>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 220 }}
          className="text-stone-400 dark:text-stone-500"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="overflow-hidden"
          >
            <div className="space-y-5 border-t border-stone-100 px-5 py-5 dark:border-stone-800">
              {/* 区块 A：已配置列表 */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                    已配置 {configuredIds.length} 个
                  </span>
                  {configuredIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void reloadConfiguredProjects()}
                      disabled={configuredLookupLoading}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-stone-500 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-default"
                    >
                      {configuredLookupLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      刷新
                    </button>
                  )}
                </div>

                {configuredIds.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50/80 px-4 py-6 text-center dark:border-stone-800 dark:bg-stone-900/50">
                    <p className="text-[13px] font-medium text-stone-700 dark:text-stone-300">
                      还没有添加任何 GitLab 题
                    </p>
                    <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">
                      在下方输入项目 ID 开始添加
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-hidden rounded-xl border border-stone-100 dark:border-stone-800">
                      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                        {configuredIds.map((id) => {
                          const project = configuredProjects.get(id);
                          const loading = configuredLookupLoading && !project;
                          const isRemoving = removingId === id;
                          return (
                            <li
                              key={id}
                              className="flex items-center gap-3 px-3.5 py-2 text-[13px]"
                            >
                              <span className="min-w-[64px] shrink-0 text-right font-mono text-stone-500 dark:text-stone-400">
                                #{id}
                              </span>
                              <span className="flex-1 truncate text-stone-700 dark:text-stone-300">
                                {project ? (
                                  project.name
                                ) : loading ? (
                                  <span className="text-stone-400">加载中…</span>
                                ) : (
                                  <span className="text-stone-400">—</span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleRemoveConfigured(id)}
                                disabled={isRemoving}
                                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-900/20 cursor-default"
                                title={`移除 #${id}`}
                              >
                                {isRemoving ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                    {configuredLookupError && (
                      <p className="mt-2 text-[11px] text-red-500">{configuredLookupError}</p>
                    )}
                  </>
                )}
              </section>

              {/* 区块 B：添加 composer */}
              {!showDone && (
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                      添加新题目
                    </span>
                    {parsedTokens.length > 0 && (
                      <span className="text-[11px] text-stone-500 dark:text-stone-400">
                        已识别 {parsedTokens.length} 个 ID
                      </span>
                    )}
                  </div>
                  <textarea
                    value={inputText}
                    onChange={(event) => setInputText(event.target.value)}
                    placeholder={'每行一个 GitLab 项目 ID\n支持空格或逗号分隔，例：\n1849  2898, 3001'}
                    rows={4}
                    disabled={verifying || saving}
                    className="min-h-[88px] w-full resize-y rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 font-mono text-sm leading-6 text-stone-800 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-slate-400/30 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200"
                  />
                  {hasInvalidChars && (
                    <p className="mt-1.5 text-[11px] text-orange-600 dark:text-orange-400">
                      含非数字内容，将被自动忽略
                    </p>
                  )}
                  {!hasInvalidChars && (
                    <p className="mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                      支持换行、空格或逗号分隔；已存在的 ID 会自动跳过
                    </p>
                  )}
                  {verifyError && (
                    <p className="mt-2 text-[12px] font-medium text-red-500">{verifyError}</p>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleVerify()}
                      disabled={verifyDisabled}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-stone-900 bg-stone-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 cursor-default"
                    >
                      {verifying ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      {verifying ? '校验中…' : '校验'}
                    </button>
                    {inputText.length > 0 && (
                      <button
                        type="button"
                        onClick={handleReset}
                        disabled={verifying || saving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-300 dark:hover:bg-stone-800/60 cursor-default"
                      >
                        清空
                      </button>
                    )}
                  </div>
                </section>
              )}

              {/* 区块 C：校验结果 */}
              <AnimatePresence initial={false} mode="wait">
                {showResults && (
                  <motion.section
                    key="results"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                      <span>
                        可加入 <b className="text-emerald-600 dark:text-emerald-400">{summaryOk}</b>
                      </span>
                      <span className="text-stone-300 dark:text-stone-700">·</span>
                      <span>
                        已配置 <b className="text-stone-600 dark:text-stone-300">{summaryExisting}</b>
                      </span>
                      {summaryError > 0 && (
                        <>
                          <span className="text-stone-300 dark:text-stone-700">·</span>
                          <span>
                            不可达 <b className="text-red-500">{summaryError}</b>
                          </span>
                        </>
                      )}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-stone-100 dark:border-stone-800">
                      <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                        <AnimatePresence initial>
                          {visibleRows.map((row, index) => (
                            <motion.li
                              key={row.rawId}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -2 }}
                              transition={{ delay: index * 0.025, duration: 0.18 }}
                              className={`flex items-start gap-2.5 px-3.5 py-2 text-[13px] ${
                                row.status === 'ok'
                                  ? 'bg-emerald-50/40 dark:bg-emerald-500/5'
                                  : row.status === 'error'
                                    ? 'bg-red-50/40 dark:bg-red-900/10'
                                    : ''
                              }`}
                            >
                              <span className="mt-1 flex-none">
                                <StatusIcon status={row.status} />
                              </span>
                              <span className="min-w-[56px] shrink-0 pt-0.5 text-right font-mono text-stone-500 dark:text-stone-400">
                                #{row.numId}
                              </span>
                              <div className="min-w-0 flex-1">
                                {row.status === 'ok' && (
                                  <span className="block truncate text-stone-800 dark:text-stone-200">
                                    {row.projectName || '—'}
                                  </span>
                                )}
                                {row.status === 'existing' && (
                                  <span className="block truncate text-stone-500 dark:text-stone-400">
                                    该题已在题库中，将被跳过
                                  </span>
                                )}
                                {row.status === 'error' && (
                                  <span className="block text-red-600 dark:text-red-400">
                                    {row.errorMsg}
                                  </span>
                                )}
                              </div>
                              <span
                                className={`flex-none rounded-full px-2 py-0.5 text-[11px] font-medium ${badgeByStatus[row.status]}`}
                              >
                                {labelByStatus[row.status]}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleExcludeRow(row.numId)}
                                disabled={saving}
                                className="ml-1 flex-none rounded-md p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-300 cursor-default"
                                title="从列表移除"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </motion.li>
                          ))}
                        </AnimatePresence>
                      </ul>
                    </div>

                    {saveError && (
                      <p className="mt-2 text-[12px] font-medium text-red-500">{saveError}</p>
                    )}

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleReset}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-300 dark:hover:bg-stone-800/60 cursor-default"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleConfirmAdd()}
                        disabled={saving || addableCount === 0}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-stone-900 bg-stone-900 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-50 dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 cursor-default"
                      >
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {saving
                          ? '保存中…'
                          : addableCount > 0
                            ? `加入 ${addableCount} 个题`
                            : '无可加入的题目'}
                      </button>
                    </div>
                  </motion.section>
                )}

                {showDone && (
                  <motion.section
                    key="done"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10"
                  >
                    <div className="flex items-center gap-2.5 text-[13px] text-emerald-800 dark:text-emerald-300">
                      <Check className="h-4 w-4" />
                      <span>
                        已成功加入 <b>{addedCount}</b> 个题目
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleReset}
                        className="inline-flex items-center rounded-lg border border-stone-200 bg-white/80 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-300 dark:hover:bg-stone-800/60 cursor-default"
                      >
                        继续添加
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSync()}
                        disabled={syncing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-600 bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 cursor-default"
                      >
                        {syncing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <GitBranch className="h-3.5 w-3.5" />
                        )}
                        {syncing ? '同步中…' : '立即同步 GitLab'}
                      </button>
                    </div>
                  </motion.section>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
