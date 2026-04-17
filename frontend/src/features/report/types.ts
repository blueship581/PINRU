export interface ReportRow {
  taskId: string;
  repoId: number;
  sessionId: string;
  sessionIndex: number;
  promptText: string | null;

  taskType: string;
  projectType: string;
  changeScope: string;
  isCompleted: boolean | null;
  isSatisfied: boolean | null;
  dissatisfactionReason: string;

  aiProjectType: string;
  aiChangeScope: string;
}

export const PROJECT_TYPE_OPTIONS = [
  '全栈Web应用',
  'Web前端',
  '纯后端服务',
  '游戏开发',
  '数据分析与可视化',
  '3D/交互可视化',
  'AI/ML应用',
  '科学计算',
  '命令行工具',
  '桌面应用（含GUI）',
  '自动化与工具脚本',
] as const;

export const CHANGE_SCOPE_OPTIONS = [
  '单文件',
  '模块内多文件',
  '跨模块多文件',
  '跨系统多模块',
] as const;

export const REPORT_TYPE_OPTIONS = [
  { value: 'solo', label: 'Solo 报表' },
] as const;
