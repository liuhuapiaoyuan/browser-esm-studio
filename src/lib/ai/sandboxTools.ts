import { tool } from "ai";
import { z } from "zod";
import { SandboxError, type Sandbox } from "../sandbox";

function toolError(error: unknown) {
  if (error instanceof SandboxError) {
    return { ok: false as const, code: error.code, error: error.message, path: error.path };
  }
  return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
}

/** Sandbox SDK tools for the executor agent. Mutates only through Sandbox. */
export function createSandboxTools(sandbox: Sandbox) {
  return {
    listFiles: tool({
      description: "List all virtual project file paths, sorted.",
      inputSchema: z.object({
        // Some OpenAI-compatible models reject completely empty tool schemas.
        include: z.literal("all").optional().describe("Optional; omit or pass all"),
      }),
      execute: async () => ({ ok: true as const, files: sandbox.list() }),
    }),

    readFile: tool({
      description: "Read a virtual file by relative path.",
      inputSchema: z.object({
        path: z.string().describe("Relative path, e.g. src/App.tsx"),
      }),
      execute: async ({ path }) => {
        try {
          return { ok: true as const, path, content: sandbox.read(path) };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    grep: tool({
      description:
        "Search file contents. Modes: literal (default), regex=true, or fuzzy=true (subsequence / multi-token approximate match, e.g. usSt→useState, case-insensitive by default). Optional glob limits paths (e.g. **/*.tsx). Do not combine regex with fuzzy.",
      inputSchema: z.object({
        query: z.string().describe("Search text, RegExp source, or fuzzy query"),
        regex: z.boolean().optional().describe("Treat query as RegExp"),
        fuzzy: z
          .boolean()
          .optional()
          .describe("Fuzzy subsequence search; spaces split required tokens"),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Default true for literal/regex; default false for fuzzy"),
        paths: z.array(z.string()).optional().describe("Limit to these relative paths"),
        glob: z.string().optional().describe('Path glob, e.g. "src/**/*.tsx" or "*.css"'),
        maxResults: z.number().int().positive().max(200).optional(),
      }),
      execute: async (input) => {
        try {
          const matches = sandbox.grep(input.query, {
            regex: input.regex,
            fuzzy: input.fuzzy,
            caseSensitive: input.caseSensitive,
            paths: input.paths,
            glob: input.glob,
            maxResults: input.maxResults,
          });
          return { ok: true as const, count: matches.length, matches };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    writeFile: tool({
      description: "Create or overwrite a file. Prefer replace for small edits.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string(),
      }),
      execute: async ({ path, content }) => {
        try {
          return { ok: true as const, ...sandbox.write(path, content) };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    addFile: tool({
      description: "Create a new file. Fails if it already exists.",
      inputSchema: z.object({
        path: z.string(),
        content: z.string().optional(),
      }),
      execute: async ({ path, content }) => {
        try {
          return { ok: true as const, ...sandbox.add(path, content ?? "") };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    removeFile: tool({
      description: "Delete a file. index.html and package.json are protected.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        try {
          return { ok: true as const, ...sandbox.remove(path) };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    replaceInFile: tool({
      description: "Replace text in one file. Use replaceAll for multiple occurrences.",
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        regex: z.boolean().optional(),
        replaceAll: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
      }),
      execute: async (input) => {
        try {
          return {
            ok: true as const,
            ...sandbox.replace(input.path, input.oldString, input.newString, {
              regex: input.regex,
              replaceAll: input.replaceAll,
              caseSensitive: input.caseSensitive,
            }),
          };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    applyOperations: tool({
      description:
        "Apply multiple Sandbox operations atomically. On failure the whole batch rolls back.",
      inputSchema: z.object({
        operations: z.array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("write"),
              path: z.string(),
              content: z.string(),
            }),
            z.object({
              type: z.literal("add"),
              path: z.string(),
              content: z.string().optional(),
            }),
            z.object({
              type: z.literal("remove"),
              path: z.string(),
            }),
            z.object({
              type: z.literal("replace"),
              path: z.string(),
              oldString: z.string(),
              newString: z.string(),
              regex: z.boolean().optional(),
              replaceAll: z.boolean().optional(),
              caseSensitive: z.boolean().optional(),
            }),
          ]),
        ),
      }),
      execute: async ({ operations }) => {
        try {
          return { ok: true as const, ...sandbox.apply(operations) };
        } catch (error) {
          return toolError(error);
        }
      },
    }),
  };
}

export type SandboxTools = ReturnType<typeof createSandboxTools>;
