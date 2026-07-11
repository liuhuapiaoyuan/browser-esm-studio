import { normalizePath } from "./path";
import type { FileMap } from "../types";

type MutableFileMap = Record<string, string>;

export type SandboxErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "PROTECTED_PATH"
  | "NO_MATCH"
  | "INVALID_OPERATION";

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  readonly path?: string;

  constructor(code: SandboxErrorCode, message: string, path?: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
    this.path = path;
  }
}

export type GrepMatch = {
  path: string;
  line: number;
  column: number;
  text: string;
  match: string;
  /** Lines immediately before the hit (when context > 0). */
  before?: string[];
  /** Lines immediately after the hit (when context > 0). */
  after?: string[];
  /** Present when fuzzy=true; lower is tighter / better. */
  score?: number;
};

export type GrepOptions = {
  regex?: boolean;
  /** Subsequence fuzzy match (e.g. "usSt" → "useState"). Incompatible with regex / word. */
  fuzzy?: boolean;
  /** Wrap literal/regex query with word boundaries (\b). Incompatible with fuzzy. */
  word?: boolean;
  caseSensitive?: boolean;
  paths?: string[];
  /** Glob filter on paths (supports *, ?, and **). */
  glob?: string;
  /** Include this many lines before/after each hit. */
  context?: number;
  maxResults?: number;
};

export type ReplaceOptions = {
  regex?: boolean;
  replaceAll?: boolean;
  caseSensitive?: boolean;
};

export type ReplaceResult = {
  changed: string[];
  counts: Record<string, number>;
};

export type MutationResult = {
  changed: string[];
};

export type SandboxOperation =
  | { type: "write"; path: string; content: string }
  | { type: "add"; path: string; content?: string }
  | { type: "remove"; path: string }
  | {
      type: "replace";
      path: string;
      oldString: string;
      newString: string;
      regex?: boolean;
      replaceAll?: boolean;
      caseSensitive?: boolean;
    };

const PROTECTED_PATHS = new Set(["index.html", "package.json"]);

function cloneFiles(files: FileMap | MutableFileMap): MutableFileMap {
  return { ...files };
}

function freezeSnapshot(files: MutableFileMap): FileMap {
  return Object.freeze(cloneFiles(files));
}

function assertValidPath(raw: string | null | undefined): string {
  const original = String(raw || "").trim();
  if (!original) {
    throw new SandboxError("INVALID_PATH", "Path is required.");
  }
  if (original.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(original)) {
    throw new SandboxError("INVALID_PATH", `Absolute paths are not allowed: ${original}`, original);
  }
  if (original.includes("\0")) {
    throw new SandboxError("INVALID_PATH", "Path contains invalid characters.", original);
  }

  const path = normalizePath(original);
  if (!path) {
    throw new SandboxError("INVALID_PATH", "Path is required.");
  }
  return path;
}

function assertNotProtected(path: string, action: "remove"): void {
  if (PROTECTED_PATHS.has(path)) {
    throw new SandboxError(
      "PROTECTED_PATH",
      `${path} is required by Preview and cannot be ${action === "remove" ? "deleted" : "modified"}.`,
      path,
    );
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a simple glob (`*`, `?`, `**`) to a RegExp matching the full path. */
function globToRegExp(glob: string): RegExp {
  const trimmed = glob.trim();
  if (!trimmed) {
    throw new SandboxError("INVALID_OPERATION", "Glob pattern is required when provided.");
  }

  let pattern = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === "*" && trimmed[i + 1] === "*") {
      pattern += ".*";
      i += 1;
      if (trimmed[i + 1] === "/") i += 1;
      continue;
    }
    if (char === "*") {
      pattern += "[^/]*";
      continue;
    }
    if (char === "?") {
      pattern += "[^/]";
      continue;
    }
    pattern += escapeRegExp(char);
  }

  try {
    return new RegExp(`^${pattern}$`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SandboxError("INVALID_OPERATION", `Invalid glob pattern: ${message}`);
  }
}

function matchGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

/**
 * Fuzzy query → RegExp.
 * - Whitespace splits tokens (all must appear in order, with gaps).
 * - Within a token, characters are subsequence-matched (`usSt` → `useState`).
 */
function buildFuzzyPattern(query: string, caseSensitive: boolean, global: boolean): RegExp {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => [...token].map(escapeRegExp).join(".*?"));

  if (tokens.length === 0) {
    throw new SandboxError("INVALID_OPERATION", "Search query is required.");
  }

  const flags = `${global ? "g" : ""}${caseSensitive ? "" : "i"}`;
  try {
    return new RegExp(tokens.join(".*?"), flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SandboxError("INVALID_OPERATION", `Invalid fuzzy pattern: ${message}`);
  }
}

function buildSearchPattern(
  query: string,
  options: {
    regex?: boolean;
    fuzzy?: boolean;
    word?: boolean;
    caseSensitive?: boolean;
    global?: boolean;
  },
): RegExp {
  if (!query) {
    throw new SandboxError("INVALID_OPERATION", "Search query is required.");
  }
  if (options.regex && options.fuzzy) {
    throw new SandboxError("INVALID_OPERATION", "Cannot combine regex and fuzzy search.");
  }
  if (options.word && options.fuzzy) {
    throw new SandboxError("INVALID_OPERATION", "Cannot combine word and fuzzy search.");
  }

  if (options.fuzzy) {
    return buildFuzzyPattern(query, options.caseSensitive === true, options.global === true);
  }

  const flags = `${options.global ? "g" : ""}${options.caseSensitive === false ? "i" : ""}`;
  const source = options.regex ? query : escapeRegExp(query);
  const wrapped = options.word ? `\\b(?:${source})\\b` : source;
  try {
    return new RegExp(wrapped, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SandboxError("INVALID_OPERATION", `Invalid regular expression: ${message}`);
  }
}

function clipLine(text: string, max = 240): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function replaceInContent(
  content: string,
  oldString: string,
  newString: string,
  options: ReplaceOptions = {},
): { next: string; count: number } {
  const pattern = buildSearchPattern(oldString, {
    regex: options.regex,
    caseSensitive: options.caseSensitive,
    global: options.replaceAll === true,
  });

  if (options.replaceAll) {
    let count = 0;
    const next = content.replace(pattern, () => {
      count += 1;
      return newString;
    });
    return { next, count };
  }

  const match = pattern.exec(content);
  if (!match) return { next: content, count: 0 };
  const next = `${content.slice(0, match.index)}${newString}${content.slice(match.index + match[0].length)}`;
  return { next, count: 1 };
}

type Listener = (files: FileMap) => void;

export class Sandbox {
  #files: MutableFileMap;
  #listeners = new Set<Listener>();

  constructor(files: FileMap | MutableFileMap = {}) {
    this.#files = cloneFiles(files);
  }

  get snapshot(): FileMap {
    return freezeSnapshot(this.#files);
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  list(): string[] {
    return Object.keys(this.#files).sort();
  }

  exists(path: string): boolean {
    const normalized = assertValidPath(path);
    return this.#files[normalized] !== undefined;
  }

  read(path: string): string {
    const normalized = assertValidPath(path);
    if (this.#files[normalized] === undefined) {
      throw new SandboxError("NOT_FOUND", `File not found: ${normalized}`, normalized);
    }
    return this.#files[normalized];
  }

  grep(query: string, options: GrepOptions = {}): GrepMatch[] {
    const fuzzy = options.fuzzy === true;
    const context = Math.max(0, Math.min(10, Math.floor(options.context ?? 0)));
    const pattern = buildSearchPattern(query, {
      regex: options.regex,
      fuzzy,
      word: options.word,
      // Fuzzy defaults to case-insensitive unless explicitly caseSensitive.
      caseSensitive: fuzzy ? options.caseSensitive === true : options.caseSensitive,
      global: true,
    });
    const maxResults = options.maxResults ?? 200;
    let paths = options.paths?.map(assertValidPath) ?? this.list();
    if (options.glob) {
      paths = paths.filter((path) => matchGlob(path, options.glob!));
    }
    const matches: GrepMatch[] = [];

    for (const path of paths) {
      const content = this.#files[path];
      if (content === undefined) {
        throw new SandboxError("NOT_FOUND", `File not found: ${path}`, path);
      }

      const lines = content.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(line)) !== null) {
          const entry: GrepMatch = {
            path,
            line: lineIndex + 1,
            column: match.index + 1,
            text: clipLine(line),
            match: match[0],
          };
          if (context > 0) {
            entry.before = lines
              .slice(Math.max(0, lineIndex - context), lineIndex)
              .map((l) => clipLine(l));
            entry.after = lines
              .slice(lineIndex + 1, lineIndex + 1 + context)
              .map((l) => clipLine(l));
          }
          if (fuzzy) {
            // Tighter span + earlier column ranks higher.
            entry.score = match[0].length * 1000 + match.index;
          }
          matches.push(entry);
          if (!fuzzy && matches.length >= maxResults) return matches;
          if (!pattern.global || match[0].length === 0) break;
        }
      }
    }

    if (fuzzy) {
      matches.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
      return matches.slice(0, maxResults);
    }

    return matches;
  }

  write(path: string, content: string): MutationResult {
    return this.#commit((draft) => this.#write(draft, path, content));
  }

  add(path: string, content = ""): MutationResult {
    return this.#commit((draft) => this.#add(draft, path, content));
  }

  remove(path: string): MutationResult {
    return this.#commit((draft) => this.#remove(draft, path));
  }

  replace(path: string, oldString: string, newString: string, options: ReplaceOptions = {}): ReplaceResult {
    return this.#commit((draft) => this.#replace(draft, path, oldString, newString, options));
  }

  apply(operations: SandboxOperation[]): MutationResult {
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new SandboxError("INVALID_OPERATION", "At least one operation is required.");
    }

    return this.#commit((draft) => {
      const changed = new Set<string>();
      for (const operation of operations) {
        const result = this.#applyOne(draft, operation);
        for (const path of result.changed) changed.add(path);
      }
      return { changed: [...changed] };
    });
  }

  #notify(): void {
    const snapshot = this.snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }

  #commit<T extends MutationResult>(mutate: (draft: MutableFileMap) => T): T {
    const draft = cloneFiles(this.#files);
    const result = mutate(draft);
    this.#files = draft;
    if (result.changed.length > 0) this.#notify();
    return result;
  }

  #write(draft: MutableFileMap, path: string, content: string): MutationResult {
    const normalized = assertValidPath(path);
    if (typeof content !== "string") {
      throw new SandboxError("INVALID_OPERATION", "Content must be a string.", normalized);
    }
    draft[normalized] = content;
    return { changed: [normalized] };
  }

  #add(draft: MutableFileMap, path: string, content = ""): MutationResult {
    const normalized = assertValidPath(path);
    if (draft[normalized] !== undefined) {
      throw new SandboxError("ALREADY_EXISTS", `File already exists: ${normalized}`, normalized);
    }
    if (typeof content !== "string") {
      throw new SandboxError("INVALID_OPERATION", "Content must be a string.", normalized);
    }
    draft[normalized] = content;
    return { changed: [normalized] };
  }

  #remove(draft: MutableFileMap, path: string): MutationResult {
    const normalized = assertValidPath(path);
    assertNotProtected(normalized, "remove");
    if (draft[normalized] === undefined) {
      throw new SandboxError("NOT_FOUND", `File not found: ${normalized}`, normalized);
    }
    delete draft[normalized];
    return { changed: [normalized] };
  }

  #replace(
    draft: MutableFileMap,
    path: string,
    oldString: string,
    newString: string,
    options: ReplaceOptions = {},
  ): ReplaceResult {
    const normalized = assertValidPath(path);
    if (draft[normalized] === undefined) {
      throw new SandboxError("NOT_FOUND", `File not found: ${normalized}`, normalized);
    }
    if (typeof newString !== "string") {
      throw new SandboxError("INVALID_OPERATION", "Replacement text must be a string.", normalized);
    }

    const { next, count } = replaceInContent(draft[normalized], oldString, newString, options);
    if (count === 0) {
      throw new SandboxError("NO_MATCH", `No matches found in ${normalized}.`, normalized);
    }

    draft[normalized] = next;
    return { changed: [normalized], counts: { [normalized]: count } };
  }

  #applyOne(draft: MutableFileMap, operation: SandboxOperation): MutationResult {
    switch (operation.type) {
      case "write":
        return this.#write(draft, operation.path, operation.content);
      case "add":
        return this.#add(draft, operation.path, operation.content ?? "");
      case "remove":
        return this.#remove(draft, operation.path);
      case "replace":
        return this.#replace(draft, operation.path, operation.oldString, operation.newString, {
          regex: operation.regex,
          replaceAll: operation.replaceAll,
          caseSensitive: operation.caseSensitive,
        });
      default: {
        const unexpected = operation as { type?: string };
        throw new SandboxError(
          "INVALID_OPERATION",
          `Unsupported operation type: ${unexpected.type ?? "unknown"}`,
        );
      }
    }
  }
}

export function createSandbox(files: FileMap | MutableFileMap = {}): Sandbox {
  return new Sandbox(files);
}
