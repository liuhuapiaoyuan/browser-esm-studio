import type {
  CommandErrorInfo,
  DefinedCommand,
  ExecutionRecord,
  RecoveryAction,
} from "./protocol";

export function enrichErrorFromRecovery(
  cmd: DefinedCommand,
  error: CommandErrorInfo,
): CommandErrorInfo {
  const spec = cmd.recovery?.errors?.[error.code];
  if (!spec) return error;

  const recovery: RecoveryAction[] = [
    ...(error.recovery ?? []),
    ...(spec.recovery ?? []),
  ];

  // Default recovery from suggestions when none provided
  if (recovery.length === 0 && spec.suggestions.length) {
    for (const suggestion of spec.suggestions) {
      const execMatch = /(?:call|调用|execute)\s+([a-z0-9]+(?:\.[a-zA-Z0-9]+)+)/i.exec(
        suggestion,
      );
      if (execMatch) {
        recovery.push({
          action: "execute",
          command: execMatch[1],
          reason: suggestion,
        });
      } else {
        recovery.push({ action: "ask-user", reason: suggestion });
      }
    }
  }

  return {
    ...error,
    retryable: error.retryable || spec.retryable,
    suggestions: [...(error.suggestions ?? []), ...spec.suggestions],
    recovery: recovery.length ? recovery : error.recovery,
  };
}

export function diagnoseExecution(
  record: ExecutionRecord | undefined,
  cmd?: DefinedCommand,
): {
  ok: boolean;
  cause: string;
  code?: string;
  retryable?: boolean;
  suggestions?: string[];
  suggestedActions: RecoveryAction[];
  executionId?: string;
  command?: string;
  recoveryPrompt?: string;
} {
  if (!record) {
    return {
      ok: false,
      cause: "未找到 executionId 对应的执行记录",
      suggestedActions: [],
    };
  }

  if (record.result.ok) {
    return {
      ok: true,
      cause: "该次执行已成功，无需恢复",
      suggestedActions: [],
      executionId: record.executionId,
      command: record.command,
    };
  }

  const error = record.result.error!;
  const enriched = cmd ? enrichErrorFromRecovery(cmd, error) : error;
  const suggestedActions: RecoveryAction[] = [...(enriched.recovery ?? [])];

  if (suggestedActions.length === 0 && enriched.retryable) {
    suggestedActions.push({
      action: "retry",
      command: record.command,
      reason: "错误标记为可重试；修正参数后重新 cli_execute",
      arguments: record.arguments as Record<string, unknown> | undefined,
    });
  }

  if (suggestedActions.length === 0) {
    suggestedActions.push({
      action: "describe",
      command: record.command,
      reason: "读取命令完整说明后重新生成参数",
    });
  }

  return {
    ok: false,
    cause: enriched.message,
    code: enriched.code,
    retryable: enriched.retryable,
    suggestions: enriched.suggestions ?? [],
    suggestedActions,
    executionId: record.executionId,
    command: record.command,
  };
}
