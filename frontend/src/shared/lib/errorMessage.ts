/**
 * 统一的错误转字符串工具。
 *
 * 使用方式：
 *   toErrorMessage(error)              // 未知错误默认文案
 *   toErrorMessage(error, '加载失败')  // 自定义兜底文案
 *
 * 行为：
 *   - string 原样返回（若去空后非空）
 *   - Error 实例优先返回其 message
 *   - 对象若含 message 字段则返回，其次尝试 JSON.stringify
 *   - 否则返回 fallback
 */
export function toErrorMessage(error: unknown, fallback = '未知错误'): string {
  if (typeof error === 'string') {
    return error.trim() ? error : fallback;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (error && typeof error === 'object') {
    const maybeMessage = Reflect.get(error, 'message');
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return fallback;
    }
  }

  return fallback;
}
