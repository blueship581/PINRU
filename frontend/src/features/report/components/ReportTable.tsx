import { useCallback, useRef, useState } from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import type { ReportRow } from '../types';
import { PROJECT_TYPE_OPTIONS, CHANGE_SCOPE_OPTIONS } from '../types';
import { DEFAULT_TASK_TYPES } from '../../../shared/lib/taskTypes';

interface ReportTableProps {
  rows: ReportRow[];
  onTaskTypeChange: (taskId: string, value: string) => void;
  onReportFieldsChange: (taskId: string, projectType: string, changeScope: string) => void;
  onSessionFieldChange: (
    taskId: string,
    sessionIndex: number,
    patch: {
      isCompleted?: boolean | null;
      isSatisfied?: boolean | null;
      evaluation?: string;
    },
  ) => void;
}

const thCls =
  'px-3 py-2 text-left text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wider whitespace-nowrap bg-stone-50 dark:bg-[#171B22] border-b border-stone-200 dark:border-[#232834]';
const tdCls =
  'px-3 py-2 text-sm text-stone-700 dark:text-stone-300 border-b border-stone-100 dark:border-[#232834]';
const selectCls =
  'w-full bg-transparent border border-stone-200 dark:border-[#232834] rounded px-1.5 py-1 text-sm text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none cursor-pointer';
const inputCls =
  'w-full bg-transparent border border-stone-200 dark:border-[#232834] rounded px-1.5 py-1 text-sm text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-blue-500';
const checkboxCls =
  'w-4 h-4 rounded border-stone-300 dark:border-stone-600 text-blue-600 focus:ring-blue-500 cursor-pointer';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="ml-1 inline-flex items-center text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
      title="复制"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function SelectCell({
  value,
  options,
  placeholder,
  onChange,
}: {
  value: string;
  options: readonly string[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <select
        className={selectCls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder ?? '-- 请选择 --'}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-stone-400 pointer-events-none" />
    </div>
  );
}

function PromptCell({ text }: { text: string | null }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <span className="text-stone-400">-</span>;

  const isLong = text.length > 80;
  const display = expanded || !isLong ? text : text.slice(0, 80) + '...';

  return (
    <div className="max-w-xs">
      <span className="whitespace-pre-wrap break-words text-xs">{display}</span>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="ml-1 text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400"
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}

export default function ReportTable({
  rows,
  onTaskTypeChange,
  onReportFieldsChange,
  onSessionFieldChange,
}: ReportTableProps) {
  const seenTaskIds = new Set<string>();

  return (
    <div className="overflow-auto flex-1">
      <table className="w-full border-collapse min-w-[1100px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={thCls}>RepoId</th>
            <th className={thCls}>SessionId</th>
            <th className={thCls}>Prompt</th>
            <th className={thCls}>任务类型</th>
            <th className={thCls}>业务领域</th>
            <th className={thCls}>修改范围</th>
            <th className={thCls}>是否完成</th>
            <th className={thCls}>是否满意</th>
            <th className={thCls}>不满意原因</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} className={`${tdCls} text-center text-stone-400 py-12`}>
                暂无数据
              </td>
            </tr>
          )}
          {rows.map((row, idx) => {
            const isFirstForTask = !seenTaskIds.has(row.taskId);
            if (isFirstForTask) seenTaskIds.add(row.taskId);

            return (
              <tr
                key={`${row.taskId}-${row.sessionIndex}-${idx}`}
                className="hover:bg-stone-50/50 dark:hover:bg-[#1A1F29]/50"
              >
                <td className={`${tdCls} font-mono text-xs`}>{row.repoId}</td>
                <td className={`${tdCls} font-mono text-xs`}>
                  {row.sessionId ? (
                    <span className="inline-flex items-center">
                      {row.sessionId.slice(0, 8)}
                      <CopyButton text={row.sessionId} />
                    </span>
                  ) : (
                    <span className="text-stone-400">-</span>
                  )}
                </td>
                <td className={tdCls}>
                  <PromptCell text={row.promptText} />
                </td>
                <td className={tdCls} style={{ minWidth: 120 }}>
                  {isFirstForTask ? (
                    <SelectCell
                      value={row.taskType}
                      options={DEFAULT_TASK_TYPES}
                      placeholder="选择类型"
                      onChange={(v) => onTaskTypeChange(row.taskId, v)}
                    />
                  ) : (
                    <span className="text-stone-400 text-xs">{row.taskType}</span>
                  )}
                </td>
                <td className={tdCls} style={{ minWidth: 140 }}>
                  {isFirstForTask ? (
                    <SelectCell
                      value={row.projectType}
                      options={PROJECT_TYPE_OPTIONS}
                      placeholder={row.aiProjectType || '选择领域'}
                      onChange={(v) =>
                        onReportFieldsChange(row.taskId, v, row.changeScope)
                      }
                    />
                  ) : (
                    <span className="text-stone-400 text-xs">{row.projectType}</span>
                  )}
                </td>
                <td className={tdCls} style={{ minWidth: 130 }}>
                  {isFirstForTask ? (
                    <SelectCell
                      value={row.changeScope}
                      options={CHANGE_SCOPE_OPTIONS}
                      placeholder={row.aiChangeScope || '选择范围'}
                      onChange={(v) =>
                        onReportFieldsChange(row.taskId, row.projectType, v)
                      }
                    />
                  ) : (
                    <span className="text-stone-400 text-xs">{row.changeScope}</span>
                  )}
                </td>
                <td className={`${tdCls} text-center`}>
                  {row.sessionIndex >= 0 ? (
                    <input
                      type="checkbox"
                      className={checkboxCls}
                      checked={row.isCompleted === true}
                      onChange={(e) =>
                        onSessionFieldChange(row.taskId, row.sessionIndex, {
                          isCompleted: e.target.checked,
                        })
                      }
                    />
                  ) : (
                    <span className="text-stone-400">-</span>
                  )}
                </td>
                <td className={`${tdCls} text-center`}>
                  {row.sessionIndex >= 0 ? (
                    <input
                      type="checkbox"
                      className={checkboxCls}
                      checked={row.isSatisfied === true}
                      onChange={(e) =>
                        onSessionFieldChange(row.taskId, row.sessionIndex, {
                          isSatisfied: e.target.checked,
                        })
                      }
                    />
                  ) : (
                    <span className="text-stone-400">-</span>
                  )}
                </td>
                <td className={tdCls} style={{ minWidth: 160 }}>
                  {row.sessionIndex >= 0 ? (
                    <input
                      type="text"
                      className={inputCls}
                      value={row.dissatisfactionReason}
                      placeholder="输入原因..."
                      onChange={(e) =>
                        onSessionFieldChange(row.taskId, row.sessionIndex, {
                          evaluation: e.target.value,
                        })
                      }
                    />
                  ) : (
                    <span className="text-stone-400">-</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
