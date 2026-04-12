// Wails v3 service call helper
// In production, generated bindings should be used instead.
// This is a thin wrapper for calling Go services via Wails v3 runtime.

import { Call } from '@wailsio/runtime';
import type { WailsServiceContract } from './contracts';

type ServiceName = Extract<keyof WailsServiceContract, string>;
type MethodName<S extends ServiceName> = Extract<keyof WailsServiceContract[S], string>;
type ServiceMethodDef<S extends ServiceName, M extends MethodName<S>> = WailsServiceContract[S][M];
type ServiceArgs<S extends ServiceName, M extends MethodName<S>> =
  ServiceMethodDef<S, M> extends { args: infer Args extends unknown[] } ? Args : never;
type ServiceResult<S extends ServiceName, M extends MethodName<S>> =
  ServiceMethodDef<S, M> extends { result: infer Result } ? Result : never;

const servicePrefixes: Record<ServiceName, readonly string[]> = {
  ChatService: ['github.com/blueship581/pinru/app/chat', 'main'],
  CliService: ['github.com/blueship581/pinru/app/cli', 'main'],
  ConfigService: ['github.com/blueship581/pinru/app/config', 'main'],
  GitService: ['github.com/blueship581/pinru/app/git', 'main'],
  JobService: ['github.com/blueship581/pinru/app/job', 'main'],
  PromptService: ['github.com/blueship581/pinru/app/prompt', 'main'],
  SubmitService: ['github.com/blueship581/pinru/app/submit', 'main'],
  TaskService: ['github.com/blueship581/pinru/app/task', 'main'],
};

const resolvedServicePrefixes = new Map<ServiceName, string>();

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

function isUnknownBoundMethodError(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error);

  return rawMessage.includes('unknown bound method name');
}

export async function callService<S extends ServiceName, M extends MethodName<S>>(
  serviceName: S,
  methodName: M,
  ...args: ServiceArgs<S, M>
): Promise<ServiceResult<S, M>> {
  let lastError: unknown = null;
  const cachedPrefix = resolvedServicePrefixes.get(serviceName);
  const candidatePrefixes = cachedPrefix
    ? [
        cachedPrefix,
        ...servicePrefixes[serviceName].filter((prefix) => prefix !== cachedPrefix),
      ]
    : servicePrefixes[serviceName];

  for (const prefix of candidatePrefixes) {
    try {
      const result = await Call.ByName(`${prefix}.${serviceName}.${methodName}`, ...args);
      resolvedServicePrefixes.set(serviceName, prefix);
      return result;
    } catch (error) {
      lastError = error;
      if (!isUnknownBoundMethodError(error)) {
        throw normalizeServiceError(error);
      }
    }
  }

  throw normalizeServiceError(lastError);
}
