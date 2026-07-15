import { SandboxError, type GrepMatch } from "../../../sandbox";
import { AgentCliCommandError } from "../../protocol";

export const MAX_PER_FILE = 20;
export const MAX_READ_WINDOW = 200;
export const DEFAULT_READ_RADIUS = 40;

export function mapSandboxError(error: unknown): never {
  if (error instanceof AgentCliCommandError) throw error;
  if (error instanceof SandboxError) {
    const code =
      error.code === "NOT_FOUND"
        ? "RESOURCE_NOT_FOUND"
        : error.code === "ALREADY_EXISTS"
          ? "RESOURCE_CONFLICT"
          : error.code === "NO_MATCH"
            ? "NO_MATCH"
            : error.code === "PROTECTED_PATH"
              ? "PERMISSION_DENIED"
              : "INVALID_ARGUMENT";
    throw new AgentCliCommandError(code, error.message, {
      retryable: error.code === "NO_MATCH" || error.code === "NOT_FOUND",
      field: error.path ? `/path` : undefined,
      details: { sandboxCode: error.code, path: error.path },
      suggestions:
        error.code === "NO_MATCH"
          ? ["用 sandbox.readFile 确认原文后重试 sandbox.replaceInFile"]
          : error.code === "NOT_FOUND"
            ? ["先 sandbox.listFiles 或 sandbox.grep 确认路径"]
            : undefined,
    });
  }
  throw new AgentCliCommandError(
    "INTERNAL_ERROR",
    error instanceof Error ? error.message : String(error),
    { retryable: false },
  );
}

/**
 * Slice a file for progressive exploration after grep.
 * Windowed reads include `LINE|` prefixes so the agent can map hits; full reads stay raw.
 */
export function formatReadWindow(
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
export function formatGrepResult(
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
    outputMode,
    count: totalMatches,
    fileCount: files.length,
    truncated,
    ...(omitted > 0 ? { omitted } : {}),
    files,
  };
}
