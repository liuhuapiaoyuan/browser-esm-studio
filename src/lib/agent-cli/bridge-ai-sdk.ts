import { tool } from "ai";
import { z } from "zod";
import type { AgentCliRuntime } from "./runtime";
import { coerceCliExecuteInput } from "./normalize-args";

/** Meta-tools are AI SDK tools — not registry commands. Models often wrap them in cli_execute. */
const META_TOOL_NAMES = new Set([
  "cli_search",
  "cli_describe",
  "cli_diagnose",
  "cli_execute",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asLimit(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * If the model passes a meta-tool name as cli_execute.command, fulfill it here
 * instead of returning COMMAND_NOT_FOUND from the registry.
 */
async function fulfillMetaViaExecute(
  runtime: AgentCliRuntime,
  command: string,
  args: Record<string, unknown>,
) {
  if (command === "cli_search") {
    const query = asString(args.query) ?? asString(args.q) ?? "";
    const limit = asLimit(args.limit) ?? 5;
    return {
      ok: true as const,
      query,
      commands: runtime.search(query, limit),
      note: "cli_search is a meta-tool; call it directly next time, not via cli_execute.",
    };
  }

  if (command === "cli_describe") {
    const target =
      asString(args.command) ?? asString(args.name) ?? asString(args.target) ?? "";
    if (!target) {
      return {
        ok: false as const,
        error: {
          code: "INVALID_ARGUMENT" as const,
          message:
            "cli_describe 需要 arguments.command（注册命令名，如 image.generate）。不要把 cli_describe 当作 registry 命令。",
          retryable: true,
        },
      };
    }
    const detail = args.detail === "short" ? "short" : "full";
    const described = runtime.describe(target, detail);
    if (!described.ok) {
      return { ok: false as const, error: described.error };
    }
    return {
      ok: true as const,
      command: described.command,
      prompt: described.prompt,
      manifest: described.manifest,
      note: "cli_describe is a meta-tool; call it directly next time, not via cli_execute.",
    };
  }

  if (command === "cli_diagnose") {
    return {
      ...(await runtime.diagnose(asString(args.executionId))),
      note: "cli_diagnose is a meta-tool; call it directly next time, not via cli_execute.",
    };
  }

  // command === "cli_execute"
  return {
    ok: false as const,
    error: {
      code: "INVALID_ARGUMENT" as const,
      message:
        "不要把 cli_execute 当作 command。应传入注册命令名（如 image.generate / sandbox.readFile）。",
      retryable: true,
      suggestions: [
        "先调用 meta-tool cli_search 搜索可用命令",
        '再 cli_execute({ command: "namespace.command", arguments: {...} })',
      ],
    },
  };
}

export function createAgentCliTools(runtime: AgentCliRuntime) {
  return {
    cli_search: tool({
      description:
        "Meta-tool (not a registry command): search registered Agent CLI commands by task keywords. Call this tool directly — never pass cli_search as cli_execute.command. Use before cli_execute when unsure which command to use.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language task or command keywords"),
        limit: z.number().int().min(1).max(20).optional().describe("Max hits (default 5)"),
      }),
      execute: async ({ query, limit }) => {
        const commands = runtime.search(query, limit ?? 5);
        return { ok: true as const, query, commands };
      },
    }),

    cli_describe: tool({
      description:
        "Meta-tool (not a registry command): load full parameters for one registered CLI command. Call this tool directly — never pass cli_describe as cli_execute.command.",
      inputSchema: z.object({
        command: z.string().describe("Registered command name returned by cli_search"),
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
      description: `Execute a registered Agent CLI command (namespace.command from cli_search).

Canonical form:
{ "command": "image.generate", "arguments": { "prompt": "..." } }

Do NOT pass meta-tool names (cli_search / cli_describe / cli_diagnose) as command — those are separate tools.
Flattened arguments are accepted for compatibility. Call cli_describe when fields are unclear.`,
      inputSchema: z
        .object({
          command: z
            .string()
            .describe("Registered command name only (e.g. image.generate). Not cli_search."),
          arguments: z
            .record(z.string(), z.unknown())
            .optional()
            .describe("Command args object (preferred)"),
          args: z.record(z.string(), z.unknown()).optional().describe("Alias of arguments"),
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
        if (META_TOOL_NAMES.has(command)) {
          return fulfillMetaViaExecute(runtime, command, args);
        }
        return runtime.execute(command, args);
      },
    }),

    cli_diagnose: tool({
      description:
        "Meta-tool (not a registry command): diagnose a failed cli_execute by executionId. Call this tool directly — never pass cli_diagnose as cli_execute.command.",
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
