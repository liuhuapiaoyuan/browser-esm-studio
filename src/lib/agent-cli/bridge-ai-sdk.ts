import { tool } from "ai";
import { z } from "zod";
import type { AgentCliRuntime } from "./runtime";
import { coerceCliExecuteInput } from "./normalize-args";

export function createAgentCliTools(runtime: AgentCliRuntime) {
  return {
    cli_search: tool({
      description:
        "Search registered Agent CLI commands by task keywords. Call before cli_execute when unsure which command to use. Do not guess command names.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language or keyword query, e.g. schema setup"),
        limit: z.number().int().min(1).max(20).optional().describe("Max hits (default 5)"),
      }),
      execute: async ({ query, limit }) => {
        const commands = runtime.search(query, limit ?? 5);
        return { ok: true as const, query, commands };
      },
    }),

    cli_describe: tool({
      description:
        "Load full parameters, examples, safety, and recovery instructions for one CLI command. Call when unsure about arguments.",
      inputSchema: z.object({
        command: z.string().describe("Command name, e.g. ddb.setupSchema"),
        detail: z.enum(["short", "full"]).optional().describe("short | full (default full)"),
      }),
      execute: async ({ command, detail }) => {
        const described = runtime.describe(command, detail ?? "full");
        if (!described.ok) {
          return { ok: false as const, error: described.error };
        }
        return {
          ok: true as const,
          command: described.command,
          prompt: described.prompt,
          manifest: described.manifest,
        };
      },
    }),

    cli_execute: tool({
      description: `Execute a registered Agent CLI command.

Canonical form:
{ "command": "sandbox.replaceInFile", "arguments": { "path": "src/App.tsx", "oldString": "a", "newString": "b" } }

Flattened form is also accepted:
{ "command": "sandbox.replaceInFile", "path": "src/App.tsx", "oldString": "a", "newString": "b" }

For applyOperations, each op.type must be one of: write | add | remove | replace.
Never invent shell strings. Prefer cli_describe if unsure about fields.`,
      inputSchema: z
        .object({
          command: z.string().describe("Command name, e.g. sandbox.replaceInFile"),
          arguments: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Command args object (preferred)"),
          args: z.record(z.string(), z.unknown()).optional().describe("Alias of arguments"),
          // Allow common flattened fields without rejecting the whole call.
          path: z.string().optional(),
          content: z.string().optional(),
          oldString: z.string().optional(),
          newString: z.string().optional(),
          query: z.string().optional(),
          operations: z.array(z.record(z.string(), z.unknown())).optional(),
        })
        .passthrough(),
      execute: async (raw) => {
        const { command, arguments: args } = coerceCliExecuteInput(raw);
        if (!command) {
          return {
            ok: false as const,
            error: {
              code: "INVALID_ARGUMENT",
              message: "缺少 command",
              retryable: true,
            },
          };
        }
        return runtime.execute(command, args);
      },
    }),

    cli_diagnose: tool({
      description:
        "Diagnose a failed cli_execute by executionId (or the latest failure) and return structured recovery actions.",
      inputSchema: z.object({
        executionId: z
          .string()
          .optional()
          .describe("executionId from a failed cli_execute result; omit for latest failure"),
      }),
      execute: async ({ executionId }) => {
        return runtime.diagnose(executionId);
      },
    }),
  };
}
