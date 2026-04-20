/**
 * 前端统一错误 / 提示文案。
 *
 * 原则：
 *   1. 面向用户的提示文案尽量集中到此处，避免散落在各组件内。
 *   2. 文案必须是中文，不得出现英文短语或后端内部字段名。
 *   3. 带参数的使用 Fmt* 函数；静态文案使用 Msg* 常量。
 */

// ---------- 领题 ----------
export const MsgClaimWaitTimeout = '等待拉取任务完成超时';
export const MsgClaimCanceled = '拉取任务已取消';
export const MsgClaimProjectNoCloneURL = '当前项目缺少克隆地址，无法拉取';
export const MsgClaimGitLabSettingsMissing = '请先在设置页面配置 GitLab URL 和 Token';

export function fmtClaimDirConflict(names: string): string {
  return `目录冲突：以下目录已存在：${names}。请先删除或更换路径`;
}

export function fmtClaimSourceFail(modelId: string): string {
  return `${modelId}：源码拉取失败`;
}

export function fmtClaimParsePayloadFail(detail: string): string {
  return `解析拉取结果失败：${detail}`;
}

export function fmtClaimSearchFail(detail: string): string {
  return `查询失败：${detail}`;
}

// ---------- 目录选择 ----------
export const MsgDirNotExist = '所选目录不存在';
export const MsgPathNotDir = '所选路径不是文件夹';
export const MsgDirNotEmpty = '所选文件夹不是空文件夹，无法创建项目，请改选空文件夹';

// ---------- 项目设置 ----------
export const MsgSourceRepoFormat = '源码仓库格式应为 owner/repo';
export const MsgOriginRequired = 'ORIGIN 必须存在，作为原始参照副本';
export const MsgSourceModelInList = '源码模型必须在模型列表中';

// ---------- GitLab 表单校验 ----------
export const MsgGitLabURLRequired = 'GitLab 服务器地址不能为空';
export const MsgGitLabURLScheme = 'GitLab 服务器地址必须以 http:// 或 https:// 开头';
export const MsgGitLabTokenRequired = 'GitLab 访问令牌不能为空';

// ---------- 通用 ----------
export const MsgUnknownError = '未知错误';
