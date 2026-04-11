import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import {
  BookmarkCheck,
  BookmarkPlus,
  Check,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { saveMessageAsPrompt, type ChatSession } from '../../../api/chat';
import { getAssistantDisplayContent } from '../utils/promptUtils';
import type { LiveMessage } from '../types';

type SessionItemProps = {
  session: ChatSession;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onDelete: () => void;
};

export const SessionItem: FC<SessionItemProps> = ({
  session,
  active,
  renaming,
  renameValue,
  onSelect,
  onRenameStart,
  onRenameChange,
  onRenameCommit,
  onDelete,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
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
          onChange={(event) => onRenameChange(event.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onRenameCommit();
            if (event.key === 'Escape') onRenameChange(session.title);
          }}
          onClick={(event) => event.stopPropagation()}
          className="flex-1 bg-transparent text-xs text-stone-700 dark:text-stone-300 focus:outline-none"
        />
      ) : (
        <span className="flex-1 text-xs text-stone-600 dark:text-stone-300 truncate">
          {session.title}
        </span>
      )}

      <div className="relative flex-shrink-0" ref={menuRef}>
        <button
          onClick={(event) => {
            event.stopPropagation();
            setShowMenu((value) => !value);
          }}
          className={`p-0.5 rounded-lg text-stone-400 transition-opacity cursor-default ${
            showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        {showMenu && (
          <div className="absolute right-0 top-full mt-1 z-30 w-28 bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded-xl shadow-lg overflow-hidden">
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowMenu(false);
                onRenameStart();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-stone-600 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-700 cursor-default"
            >
              <Pencil className="w-3 h-3" /> 重命名
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                setShowMenu(false);
                onDelete();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 cursor-default"
            >
              <Trash2 className="w-3 h-3" /> 删除
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

type MessageBubbleProps = {
  message: LiveMessage;
  taskId: string;
  messageId: string;
  onPromptSaved?: () => void;
};

export const MessageBubble: FC<MessageBubbleProps> = ({
  message,
  taskId,
  messageId,
  onPromptSaved,
}) => {
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
    } catch (error) {
      console.error('保存为提示词失败:', error);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 px-1">
        {isUser ? '你' : 'Claude'}
      </span>

      <div
        className={`relative group max-w-[85%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-br-md'
            : 'bg-white dark:bg-stone-800 border border-stone-200 dark:border-stone-700 text-stone-700 dark:text-stone-300 rounded-bl-md'
        }`}
      >
        {message.pending && !message.content ? (
          <div className="flex items-center gap-1.5 py-0.5">
            <span
              className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-current opacity-60 animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        ) : (
          <pre className="font-mono text-[12.5px] leading-[1.7] whitespace-pre-wrap break-words">
            {displayContent}
          </pre>
        )}

        {displayContent && !message.pending && (
          <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isUser && (
              <button
                onClick={handleSaveAsPrompt}
                title="保存为提示词"
                className="p-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 cursor-default"
              >
                {saved ? (
                  <BookmarkCheck className="w-3 h-3" />
                ) : (
                  <BookmarkPlus className="w-3 h-3" />
                )}
              </button>
            )}
            <button
              onClick={handleCopy}
              className={`p-1 rounded-lg cursor-default ${
                isUser
                  ? 'text-white/60 hover:text-white/90 hover:bg-white/10'
                  : 'text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700'
              }`}
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <span className="text-[10px] font-mono">copy</span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

type EmptyChatProps = {
  hasTask: boolean;
  hasPath: boolean;
  hasSession: boolean;
  cliAvailable: boolean | null;
  onNewSession: () => void;
};

export const EmptyChat: FC<EmptyChatProps> = ({
  hasTask,
  hasPath,
  hasSession,
  cliAvailable,
  onNewSession,
}) => {
  let body: ReactNode;

  if (!hasTask) {
    body = <p className="text-sm text-stone-400 dark:text-stone-500">请从左上角选择一个任务</p>;
  } else if (cliAvailable === false) {
    body = (
      <div className="text-center space-y-2">
        <p className="text-sm font-medium text-stone-600 dark:text-stone-400">
          未检测到 claude CLI
        </p>
        <p className="text-xs text-stone-400 dark:text-stone-500 font-mono">
          npm install -g @anthropic-ai/claude-code
        </p>
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

  return <div className="h-full flex items-center justify-center px-8">{body}</div>;
};
