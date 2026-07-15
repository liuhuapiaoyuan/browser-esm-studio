export type {
  AgentCliContext,
  AgentCliErrorCode,
  AgentCliPlugin,
  AgentCliRisk,
  CommandResult,
  DefinedCommand,
  ExecutionRecord,
  PreviewConsoleAccess,
  RecoveryAction,
  SearchHit,
} from "./protocol";
export { AgentCliCommandError } from "./protocol";
export { defineCommand, definePlugin } from "./define-command";
export { createAgentCliRuntime, type AgentCliRuntime } from "./runtime";
export { createAgentCliTools } from "./bridge-ai-sdk";
export { createRegistry } from "./registry";
export { validateInput } from "./validator";
export {
  compileAgentPrompt,
  compileSearchPrompt,
  compileRecoveryPrompt,
  describeCommandJson,
} from "./prompt-compiler";
