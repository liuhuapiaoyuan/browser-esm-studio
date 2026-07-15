import type { CommandErrorInfo, CommandResult, CommandResultMeta } from "./protocol";

let execSeq = 0;

export function nextExecutionId(): string {
  execSeq += 1;
  const stamp = Date.now().toString(36);
  return `exec_${stamp}_${execSeq.toString(36)}`;
}

export function successResult<T>(options: {
  command: string;
  version: string;
  executionId: string;
  data: T;
  warnings?: string[];
  meta: CommandResultMeta;
}): CommandResult<T> {
  return {
    ok: true,
    command: options.command,
    version: options.version,
    executionId: options.executionId,
    data: options.data,
    warnings: options.warnings ?? [],
    meta: options.meta,
  };
}

export function failureResult(options: {
  command: string;
  version: string;
  executionId: string;
  error: CommandErrorInfo;
  meta: CommandResultMeta;
}): CommandResult {
  return {
    ok: false,
    command: options.command,
    version: options.version,
    executionId: options.executionId,
    error: options.error,
    warnings: [],
    meta: options.meta,
  };
}
