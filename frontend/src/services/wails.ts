// Wails v3 service call helper
// In production, generated bindings should be used instead.
// This is a thin wrapper for calling Go services via Wails v3 runtime.

import { Call } from '@wailsio/runtime';

function normalizeServiceError(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  try {
    const parsed = JSON.parse(rawMessage) as { message?: unknown };
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return new Error(parsed.message);
    }
  } catch {
    // Ignore parse failures and fall back to the raw message.
  }

  return new Error(rawMessage);
}

export async function callService<T>(
  serviceName: string,
  methodName: string,
  ...args: unknown[]
): Promise<T> {
  try {
    return await Call.ByName(`main.${serviceName}.${methodName}`, ...args);
  } catch (error) {
    throw normalizeServiceError(error);
  }
}
