import type { z } from "zod";
import type {
  AgentCommandAgentMeta,
  AgentCommandExecution,
  AgentCommandMetadata,
  AgentCommandSafety,
  AgentCliContext,
  CommandRecoverySpec,
  DefinedCommand,
} from "./protocol";

export type DefineCommandOptions<TInput, TOutput> = {
  metadata: AgentCommandMetadata;
  agent: AgentCommandAgentMeta;
  inputSchema: z.ZodType<TInput>;
  outputSchema?: z.ZodType<TOutput>;
  execution?: Partial<AgentCommandExecution>;
  safety: AgentCommandSafety;
  recovery?: CommandRecoverySpec;
  execute: (input: TInput, context: AgentCliContext) => Promise<TOutput> | TOutput;
};

export function defineCommand<TInput, TOutput = unknown>(
  options: DefineCommandOptions<TInput, TOutput>,
): DefinedCommand<TInput, TOutput> {
  return {
    apiVersion: "agent-cli/v1",
    metadata: options.metadata,
    agent: options.agent,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    execution: {
      adapter: "native",
      timeoutMs: options.execution?.timeoutMs ?? 60_000,
    },
    safety: {
      ...options.safety,
      confirmation: options.safety.confirmation ?? "never",
    },
    recovery: options.recovery,
    execute: options.execute,
  };
}

export function definePlugin(options: {
  name: string;
  version: string;
  commands: DefinedCommand[];
}) {
  return options;
}
