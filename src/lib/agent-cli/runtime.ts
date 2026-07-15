import type { Sandbox } from "../sandbox";
import type {
  AgentCliContext,
  AgentCliPlugin,
  CommandErrorInfo,
  CommandResult,
  DefinedCommand,
  ExecutionRecord,
} from "./protocol";
import { AgentCliCommandError } from "./protocol";
import { createRegistry, type CommandRegistry } from "./registry";
import {
  compileAgentPrompt,
  compileRecoveryPrompt,
  compileSearchPrompt,
  describeCommandJson,
} from "./prompt-compiler";
import { diagnoseExecution, enrichErrorFromRecovery } from "./recovery";
import { failureResult, nextExecutionId, successResult } from "./result";
import { validateInput } from "./validator";
import { normalizeCommandArguments } from "./normalize-args";

const MAX_EXECUTION_HISTORY = 50;

export type AgentCliRuntimeOptions = {
  plugins?: AgentCliPlugin[];
  commands?: DefinedCommand[];
  context: {
    sandbox: Sandbox;
    previewConsole?: import("./protocol").PreviewConsoleAccess;
  };
  signal?: AbortSignal;
};

export type AgentCliRuntime = {
  registry: CommandRegistry;
  search: (query: string, limit?: number) => ReturnType<CommandRegistry["search"]>;
  describe: (
    command: string,
    detail?: "short" | "full",
  ) =>
    | { ok: true; command: string; prompt: string; searchPrompt: string; manifest: unknown }
    | { ok: false; error: string };
  validate: (
    command: string,
    input: unknown,
  ) =>
    | { ok: true; command: string; data: unknown }
    | { ok: false; command?: string; error: CommandResult["error"] | { message: string } };
  execute: (command: string, args?: unknown) => Promise<CommandResult>;
  diagnose: (executionId?: string) => ReturnType<typeof diagnoseExecution>;
  getExecution: (executionId: string) => ExecutionRecord | undefined;
  list: () => Array<{
    name: string;
    summary: string;
    title: string;
    risk: string;
    tags: string[];
  }>;
};

export function createAgentCliRuntime(options: AgentCliRuntimeOptions): AgentCliRuntime {
  const registry = createRegistry();
  for (const plugin of options.plugins ?? []) {
    registry.registerAll(plugin.commands);
  }
  if (options.commands?.length) {
    registry.registerAll(options.commands);
  }

  const history: ExecutionRecord[] = [];
  const byId = new Map<string, ExecutionRecord>();

  const baseContext = (): AgentCliContext => ({
    sandbox: options.context.sandbox,
    previewConsole: options.context.previewConsole,
    signal: options.signal,
  });

  function remember(record: ExecutionRecord) {
    history.push(record);
    byId.set(record.executionId, record);
    while (history.length > MAX_EXECUTION_HISTORY) {
      const old = history.shift();
      if (old) byId.delete(old.executionId);
    }
  }

  function search(query: string, limit = 5) {
    return registry.search(query, limit);
  }

  function describe(command: string, detail: "short" | "full" = "full") {
    const cmd = registry.get(command);
    if (!cmd) {
      return { ok: false as const, error: `未知命令: ${command}` };
    }
    return {
      ok: true as const,
      command: cmd.metadata.name,
      prompt: compileAgentPrompt(cmd, detail),
      searchPrompt: compileSearchPrompt(cmd),
      manifest: describeCommandJson(cmd),
    };
  }

  function validate(command: string, input: unknown) {
    const cmd = registry.get(command);
    if (!cmd) {
      return {
        ok: false as const,
        error: { message: `未知命令: ${command}`, code: "COMMAND_NOT_FOUND" as const },
      };
    }
    const checked = validateInput(cmd.inputSchema, input ?? {});
    if (!checked.ok) {
      return { ok: false as const, command: cmd.metadata.name, error: checked.error };
    }
    return { ok: true as const, command: cmd.metadata.name, data: checked.data };
  }

  async function execute(command: string, args: unknown = {}): Promise<CommandResult> {
    const executionId = nextExecutionId();
    const started = Date.now();
    const cmd = registry.get(command);

    if (!cmd) {
      const result = failureResult({
        command,
        version: "0.0.0",
        executionId,
        error: {
          code: "COMMAND_NOT_FOUND",
          message: `未知命令: ${command}`,
          retryable: false,
          suggestions: ["先调用 cli_search 搜索可用命令"],
          recovery: [{ action: "ask-user", reason: "命令不存在，请搜索后重试" }],
        },
        meta: { durationMs: Date.now() - started, attempt: 1 },
      });
      remember({
        executionId,
        command,
        version: "0.0.0",
        arguments: args,
        result,
        at: Date.now(),
      });
      return result;
    }

    const normalizedArgs = normalizeCommandArguments(cmd.metadata.name, args ?? {});
    const checked = validateInput(cmd.inputSchema, normalizedArgs);
    if (!checked.ok) {
      const error = enrichErrorFromRecovery(cmd, checked.error);
      const result = failureResult({
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        executionId,
        error,
        meta: { durationMs: Date.now() - started, attempt: 1 },
      });
      remember({
        executionId,
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        arguments: normalizedArgs,
        result,
        at: Date.now(),
      });
      return result;
    }

    try {
      const timeoutMs = cmd.execution.timeoutMs ?? 60_000;
      const data = await Promise.race([
        Promise.resolve(cmd.execute(checked.data, baseContext())),
        new Promise<never>((_, reject) => {
          const t = setTimeout(() => {
            reject(
              new AgentCliCommandError("TIMEOUT", `命令超时（${timeoutMs}ms）`, {
                retryable: cmd.safety.idempotent,
              }),
            );
          }, timeoutMs);
          options.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              reject(
                new AgentCliCommandError("CANCELLED", "执行已取消", { retryable: false }),
              );
            },
            { once: true },
          );
        }),
      ]);

      const result = successResult({
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        executionId,
        data,
        meta: { durationMs: Date.now() - started, attempt: 1, exitCode: 0 },
      });
      remember({
        executionId,
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        arguments: checked.data,
        result,
        at: Date.now(),
      });
      return result;
    } catch (e) {
      const baseError: CommandErrorInfo =
        e instanceof AgentCliCommandError
          ? {
              code: e.code,
              message: e.message,
              retryable: e.retryable,
              field: e.field,
              details: e.details,
              suggestions: e.suggestions,
              recovery: e.recovery,
            }
          : {
              code: "INTERNAL_ERROR",
              message: e instanceof Error ? e.message : String(e),
              retryable: false,
            };

      const errorInfo = enrichErrorFromRecovery(cmd, baseError);

      const result = failureResult({
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        executionId,
        error: errorInfo,
        meta: { durationMs: Date.now() - started, attempt: 1, exitCode: 1 },
      });
      remember({
        executionId,
        command: cmd.metadata.name,
        version: cmd.metadata.version,
        arguments: checked.data,
        result,
        at: Date.now(),
      });
      return result;
    }
  }

  function diagnose(executionId?: string) {
    const record = executionId
      ? byId.get(executionId)
      : [...history].reverse().find((r) => !r.result.ok) ?? history[history.length - 1];
    const cmd = record ? registry.get(record.command) : undefined;
    const base = diagnoseExecution(record, cmd);
    if (record && !record.result.ok && cmd && record.result.error) {
      return {
        ...base,
        recoveryPrompt: compileRecoveryPrompt(
          cmd,
          record.result.error.code,
          record.result.error.message,
        ),
      };
    }
    return base;
  }

  function getExecution(executionId: string) {
    return byId.get(executionId);
  }

  function list() {
    return registry.list().map((cmd) => ({
      name: cmd.metadata.name,
      summary: cmd.metadata.summary,
      title: cmd.metadata.title,
      risk: cmd.safety.risk,
      tags: cmd.metadata.tags ?? [],
    }));
  }

  return {
    registry,
    search,
    describe,
    validate,
    execute,
    diagnose,
    getExecution,
    list,
  };
}
