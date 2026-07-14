import { tool } from "ai";
import { z } from "zod";
import { SandboxError, type GrepMatch, type Sandbox } from "../sandbox";

function toolError(error: unknown) {
  if (error instanceof SandboxError) {
    return { ok: false as const, code: error.code, error: error.message, path: error.path };
  }
  return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
}

const MAX_PER_FILE = 20;
/** Max lines returned from a windowed readFile (around / start–end). */
const MAX_READ_WINDOW = 200;
const DEFAULT_READ_RADIUS = 40;

/**
 * Slice a file for progressive exploration after grep.
 * Windowed reads include `LINE|` prefixes so the agent can map hits; full reads stay raw.
 */
function formatReadWindow(
  content: string,
  options: {
    startLine?: number;
    endLine?: number;
    around?: number;
    radius?: number;
  },
) {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const hasWindow =
    options.around != null || options.startLine != null || options.endLine != null;

  if (!hasWindow) {
    return {
      content,
      startLine: 1,
      endLine: totalLines,
      totalLines,
      windowed: false as const,
    };
  }

  let start: number;
  let end: number;

  if (options.around != null) {
    const center = Math.max(1, Math.floor(options.around));
    const radius = Math.min(
      80,
      Math.max(0, Math.floor(options.radius ?? DEFAULT_READ_RADIUS)),
    );
    start = Math.max(1, center - radius);
    end = Math.min(totalLines, center + radius);
  } else {
    start = Math.max(1, Math.floor(options.startLine ?? 1));
    end = Math.min(totalLines, Math.floor(options.endLine ?? totalLines));
    if (end < start) end = start;
  }

  if (end - start + 1 > MAX_READ_WINDOW) {
    end = start + MAX_READ_WINDOW - 1;
  }

  const slice = lines.slice(start - 1, end);
  const numbered = slice
    .map((line, index) => `${String(start + index).padStart(4, " ")}|${line}`)
    .join("\n");

  return {
    content: numbered,
    startLine: start,
    endLine: Math.min(end, totalLines),
    totalLines,
    windowed: true as const,
  };
}

/** Group / trim grep hits so the agent gets actionable clues without blowing the tool-result budget. */
function formatGrepResult(
  matches: GrepMatch[],
  outputMode: "files" | "content",
  maxResults: number,
) {
  const byPath = new Map<string, GrepMatch[]>();
  for (const match of matches) {
    const list = byPath.get(match.path);
    if (list) list.push(match);
    else byPath.set(match.path, [match]);
  }

  const files: Array<{
    path: string;
    matchCount: number;
    matches?: Array<{
      line: number;
      column: number;
      match: string;
      text: string;
      before?: string[];
      after?: string[];
      score?: number;
    }>;
  }> = [];

  let shown = 0;
  let omitted = 0;

  for (const [path, hits] of byPath) {
    const matchCount = hits.length;
    if (outputMode === "files") {
      files.push({ path, matchCount });
      continue;
    }

    const room = Math.max(0, maxResults - shown);
    const take = Math.min(hits.length, MAX_PER_FILE, room);
    omitted += hits.length - take;
    shown += take;
    if (take === 0) {
      // Still list the file so the agent can re-query with paths/glob.
      files.push({ path, matchCount });
      continue;
    }
    files.push({
      path,
      matchCount,
      matches: hits.slice(0, take).map(({ path: _p, ...rest }) => rest),
    });
  }

  const totalMatches = matches.length;
  const truncated = outputMode === "content" ? omitted > 0 || totalMatches >= maxResults : false;

  return {
    ok: true as const,
    outputMode,
    count: totalMatches,
    fileCount: files.length,
    truncated,
    ...(omitted > 0 ? { omitted } : {}),
    files,
  };
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
      description:
        "Read a virtual file. Full file by default. After grep, expand around a hit with around+radius (or startLine/endLine). Windowed content is prefixed with `LINE|` for line mapping — strip prefixes before replaceInFile.",
      inputSchema: z.object({
        path: z.string().describe("Relative path, e.g. src/App.tsx"),
        around: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based center line from a grep hit; expands with radius"),
        radius: z
          .number()
          .int()
          .min(0)
          .max(80)
          .optional()
          .describe("Lines before/after `around` (default 40)"),
        startLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based inclusive start (alternative to around)"),
        endLine: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("1-based inclusive end (alternative to around)"),
      }),
      execute: async ({ path, around, radius, startLine, endLine }) => {
        try {
          const raw = sandbox.read(path);
          const window = formatReadWindow(raw, { around, radius, startLine, endLine });
          return { ok: true as const, path, ...window };
        } catch (error) {
          return toolError(error);
        }
      },
    }),

    grep: tool({
      description:
        "Search file contents (progressive explore step 1). Modes: literal (default), regex=true, fuzzy=true (subsequence), or word=true (identifier boundaries). outputMode=files lists paths+counts; content returns hits with small context. When a hit looks relevant, follow up with readFile(path, around=line) to expand — do not rely on large grep context alone. Do not combine regex/word with fuzzy.",
      inputSchema: z.object({
        query: z.string().describe("Search text, RegExp source, or fuzzy query"),
        regex: z.boolean().optional().describe("Treat query as RegExp"),
        fuzzy: z
          .boolean()
          .optional()
          .describe("Fuzzy subsequence search; spaces split required tokens"),
        word: z
          .boolean()
          .optional()
          .describe("Match whole identifiers only (\\b); good for symbol names"),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Default true for literal/regex; default false for fuzzy"),
        paths: z.array(z.string()).optional().describe("Limit to these relative paths"),
        glob: z.string().optional().describe('Path glob, e.g. "src/**/*.tsx" or "*.css"'),
        context: z
          .number()
          .int()
          .min(0)
          .max(10)
          .optional()
          .describe("Lines of before/after context per hit (default 2 for content mode; use readFile to expand further)"),
        outputMode: z
          .enum(["files", "content"])
          .optional()
          .describe("files = path+count only; content = hits with context (default)"),
        maxResults: z.number().int().positive().max(200).optional(),
      }),
      execute: async (input) => {
        try {
          const outputMode = input.outputMode ?? "content";
          const maxResults = input.maxResults ?? 80;
          const context = input.context ?? (outputMode === "content" ? 2 : 0);
          const matches = sandbox.grep(input.query, {
            regex: input.regex,
            fuzzy: input.fuzzy,
            word: input.word,
            caseSensitive: input.caseSensitive,
            paths: input.paths,
            glob: input.glob,
            context: outputMode === "files" ? 0 : context,
            // Fetch a bit extra so per-file capping can report omitted accurately.
            maxResults: outputMode === "files" ? maxResults : Math.min(200, maxResults * 2),
          });
          return formatGrepResult(matches, outputMode, maxResults);
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
