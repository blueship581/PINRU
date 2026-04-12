// Shared prompt-generation constants used by the Prompt page and the
// Board task-card context menu.

export const CONSTRAINT_TYPES = [
  { value: '技术栈或依赖约束', label: '技术栈约束' },
  { value: '架构或模式约束',   label: '架构约束'   },
  { value: '代码风格或规范约束', label: '代码规范约束' },
  { value: '非代码回复约束',   label: '非代码回复' },
  { value: '业务逻辑约束',     label: '业务逻辑约束' },
  { value: '无约束',           label: '无约束'     },
] as const;

export const SCOPE_TYPES = [
  { value: '单文件',       label: '单文件',     desc: '10%' },
  { value: '模块内多文件', label: '模块内多文件', desc: '30%' },
  { value: '跨模块多文件', label: '跨模块多文件', desc: '30%' },
  { value: '跨系统多模块', label: '跨系统多模块', desc: '30%' },
] as const;

export type ConstraintOption = (typeof CONSTRAINT_TYPES)[number];
export type ScopeOption = (typeof SCOPE_TYPES)[number];

// localStorage keys shared between the Prompt page and the context menu
export const LS_KEY_CONSTRAINTS = 'pinru:gen-constraints';
export const LS_KEY_SCOPE = 'pinru:gen-scope';
