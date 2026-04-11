import type {
  ChangeEvent,
  KeyboardEvent,
  RefObject,
} from 'react';
import {
  Check,
  CircleStop,
  Copy,
  Slash,
  Sparkles,
} from 'lucide-react';
import type { SkillItem } from '../../../api/cli';

type SlashMenuState = {
  open: boolean;
  filter: string;
  wordStart: number;
  activeIdx: number;
};

export function PromptComposer({
  activeSessionId,
  selectedTaskId,
  taskLocalPath,
  cliAvailable,
  input,
  inputCopied,
  sending,
  skills,
  skillPicker,
  skillSearch,
  slashMenu,
  slashFilteredSkills,
  filteredPickerSkills,
  inputRef,
  skillPickerRef,
  skillSearchRef,
  onInputChange,
  onKeyDown,
  onInputCopy,
  onToggleSkillPicker,
  onSkillSearchChange,
  onInsertSlashSkill,
  onInsertPickerSkill,
  onStop,
  onSend,
}: {
  activeSessionId: string | null;
  selectedTaskId: string;
  taskLocalPath: string | null;
  cliAvailable: boolean | null;
  input: string;
  inputCopied: boolean;
  sending: boolean;
  skills: SkillItem[];
  skillPicker: boolean;
  skillSearch: string;
  slashMenu: SlashMenuState;
  slashFilteredSkills: SkillItem[];
  filteredPickerSkills: SkillItem[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  skillPickerRef: RefObject<HTMLDivElement | null>;
  skillSearchRef: RefObject<HTMLInputElement | null>;
  onInputChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onInputCopy: () => void;
  onToggleSkillPicker: () => void;
  onSkillSearchChange: (value: string) => void;
  onInsertSlashSkill: (skillName: string) => void;
  onInsertPickerSkill: (skillName: string) => void;
  onStop: () => void;
  onSend: () => void;
}) {
  return (
    <div className="flex-shrink-0 border-t border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 px-5 py-3">
      <div className="max-w-3xl mx-auto relative">
        {slashMenu.open && slashFilteredSkills.length > 0 && (
          <div className="absolute bottom-full mb-2 left-0 right-0 z-20 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl overflow-hidden">
            <div className="px-3 py-1.5 border-b border-stone-100 dark:border-stone-800 flex items-center gap-1.5">
              <Slash className="w-3 h-3 text-stone-400" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                技能
              </span>
            </div>
            {slashFilteredSkills.map((skill, index) => (
              <button
                key={skill.name}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onInsertSlashSkill(skill.name);
                }}
                className={`w-full text-left px-3 py-2 flex items-baseline gap-2 transition-colors cursor-default ${
                  index === slashMenu.activeIdx
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

        <div className="flex items-end gap-3 rounded-2xl border border-stone-200 dark:border-stone-700 bg-stone-50 dark:bg-stone-800 px-4 py-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder={
              activeSessionId
                ? '继续对话… 输入 / 唤出技能（⌘↵ 发送）'
                : '输入第一条消息… 输入 / 唤出技能（⌘↵ 发送）'
            }
            rows={3}
            className="flex-1 bg-transparent text-sm text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none resize-none leading-[1.6]"
          />

          <button
            onClick={onInputCopy}
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

          {skills.length > 0 && (
            <div className="relative flex-shrink-0" ref={skillPickerRef}>
              <button
                onClick={() => {
                  onToggleSkillPicker();
                  onSkillSearchChange('');
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

              {skillPicker && (
                <div className="absolute bottom-full right-0 mb-2 w-72 z-20 rounded-2xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 shadow-xl overflow-hidden">
                  <div className="p-2 border-b border-stone-100 dark:border-stone-800">
                    <input
                      ref={skillSearchRef}
                      value={skillSearch}
                      onChange={(event) => onSkillSearchChange(event.target.value)}
                      placeholder="搜索技能…"
                      className="w-full bg-stone-50 dark:bg-stone-800 rounded-xl px-3 py-1.5 text-xs text-stone-700 dark:text-stone-300 placeholder:text-stone-300 dark:placeholder:text-stone-600 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto">
                    {filteredPickerSkills.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-stone-400 text-center">
                        无匹配技能
                      </p>
                    ) : (
                      filteredPickerSkills.map((skill) => (
                        <button
                          key={skill.name}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            onInsertPickerSkill(skill.name);
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
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {sending ? (
            <button
              onClick={onStop}
              className="flex-shrink-0 p-2 rounded-xl bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/40 transition-colors cursor-default"
            >
              <CircleStop className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!input.trim() || !selectedTaskId || !taskLocalPath || cliAvailable === false}
              className="flex-shrink-0 p-2 rounded-xl bg-stone-900 hover:bg-stone-800 dark:bg-stone-100 dark:hover:bg-stone-200 text-white dark:text-stone-900 transition-colors disabled:opacity-40 cursor-default"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
