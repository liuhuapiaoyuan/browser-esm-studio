import type { z } from "zod";
import type { Sandbox } from "../sandbox";

export type AgentCliRisk = "read" | "write" | "destructive" | "privileged";

export type AgentCliErrorCode =
  | "COMMAND_NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "DEPENDENCY_MISSING"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_CONFLICT"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROCESS_FAILED"
  | "OUTPUT_TOO_LARGE"
  | "CANCELLED"
  | "INTERNAL_ERROR"
  | (string & {});

export type RecoveryAction = {
  action: "execute" | "retry" | "describe" | "ask-user";
  command?: string;
  reason: string;
  arguments?: Record<string, unknown>;
};

export type CommandErrorInfo = {
  code: AgentCliErrorCode;
  message: string;
  retryable: boolean;
  field?: string;
  details?: unknown;
  suggestions?: string[];
  recovery?: RecoveryAction[];
};

export type CommandResultMeta = {
  durationMs: number;
  attempt: number;
  exitCode?: number;
};

export type CommandResult<T = unknown> = {
  ok: boolean;
  command: string;
  version: string;
  executionId: string;
  data?: T;
  warnings?: string[];
  error?: CommandErrorInfo;
  meta: CommandResultMeta;
};

export type CommandRecoverySpec = {
  maxAutoRetries: number;
  errors: Record<
    string,
    {
      description: string;
      retryable: boolean;
      suggestions: string[];
      recovery?: RecoveryAction[];
    }
  >;
};

export type AgentCommandMetadata = {
  name: string;
  version: string;
  title: string;
  summary: string;
  aliases?: string[];
  tags?: string[];
};

export type AgentCommandAgentMeta = {
  purpose: string;
  useWhen: string[];
  avoidWhen?: string[];
  instructions?: string[];
  examples: Array<{
    userRequest: string;
    input: unknown;
    explanation?: string;
  }>;
};

export type AgentCommandSafety = {
  risk: AgentCliRisk;
  sideEffect: boolean;
  confirmation?: "never" | "on-write" | "always";
  idempotent: boolean;
  permissions?: string[];
};

export type AgentCommandExecution = {
  adapter: "native";
  timeoutMs?: number;
};

export type PreviewConsoleAccess = {
  /** Current warn/error lines from the Preview iframe console bridge. */
  getErrors: () => string[];
  /** Wait for Preview sync/reload, then return current warn/error lines. */
  waitForErrors?: (settleMs?: number) => Promise<string[]>;
};

export type AgentCliContext = {
  sandbox: Sandbox;
  signal?: AbortSignal;
  previewConsole?: PreviewConsoleAccess;
};

/**
 * Thrown (or returned via fail helpers) from command execute handlers
 * so the runtime can map to structured CommandResult.error.
 */
export class AgentCliCommandError extends Error {
  readonly code: AgentCliErrorCode;
  readonly retryable: boolean;
  readonly field?: string;
  readonly details?: unknown;
  readonly suggestions?: string[];
  readonly recovery?: RecoveryAction[];

  constructor(
    code: AgentCliErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      field?: string;
      details?: unknown;
      suggestions?: string[];
      recovery?: RecoveryAction[];
    } = {},
  ) {
    super(message);
    this.name = "AgentCliCommandError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.field = options.field;
    this.details = options.details;
    this.suggestions = options.suggestions;
    this.recovery = options.recovery;
  }
}

export type DefinedCommand<TInput = any, TOutput = any> = {
  apiVersion: "agent-cli/v1";
  metadata: AgentCommandMetadata;
  agent: AgentCommandAgentMeta;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execution: AgentCommandExecution;
  safety: AgentCommandSafety;
  recovery?: CommandRecoverySpec;
  execute: (input: TInput, context: AgentCliContext) => Promise<TOutput> | TOutput;
};

export type AgentCliPlugin = {
  name: string;
  version: string;
  commands: DefinedCommand[];
};

export type SearchHit = {
  name: string;
  score: number;
  summary: string;
  title: string;
  tags: string[];
  risk: AgentCliRisk;
};

export type ExecutionRecord = {
  executionId: string;
  command: string;
  version: string;
  arguments: unknown;
  result: CommandResult;
  at: number;
};
