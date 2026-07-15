const RESERVED_EXECUTE_KEYS = new Set([
  "command",
  "arguments",
  "args",
  "input",
  "params",
  "dryRun",
  "dry_run",
]);

const KEY_ALIASES: Record<string, string> = {
  old_string: "oldString",
  new_string: "newString",
  file: "path",
  filepath: "path",
  filePath: "path",
  replace_all: "replaceAll",
  case_sensitive: "caseSensitive",
  max_results: "maxResults",
  output_mode: "outputMode",
  start_line: "startLine",
  end_line: "endLine",
  wait_ms: "waitMs",
  root_schema: "rootSchema",
  record_id: "recordId",
  page_size: "pageSize",
  batch_operation: "batchOperation",
};

/** Models often emit line/count fields as numeric strings ("40") — coerce before Zod. */
const NUMERIC_KEYS = new Set([
  "around",
  "radius",
  "startLine",
  "endLine",
  "context",
  "maxResults",
  "waitMs",
  "page",
  "pageSize",
  "limit",
  "seed",
  "numInferenceSteps",
  "guidanceScale",
  "cfg",
]);

function coerceNumericValue(value: unknown): unknown {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) return value;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : value;
}

function coerceNumericFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  for (const key of NUMERIC_KEYS) {
    if (key in out) out[key] = coerceNumericValue(out[key]);
  }
  return out;
}

const OP_TYPE_ALIASES: Record<string, string> = {
  write: "write",
  writeFile: "write",
  writefile: "write",
  add: "add",
  addFile: "add",
  addfile: "add",
  create: "add",
  remove: "remove",
  removeFile: "remove",
  removefile: "remove",
  delete: "remove",
  deleteFile: "remove",
  replace: "replace",
  replaceInFile: "replace",
  replaceinfile: "replace",
  edit: "replace",
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function renameKeys(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const mapped = KEY_ALIASES[key] ?? key;
    out[mapped] = value;
  }
  return out;
}

function normalizeOperation(op: unknown): unknown {
  const obj = asObject(parseMaybeJson(op));
  if (!obj) return op;
  const renamed = renameKeys(obj);
  const rawType =
    typeof renamed.type === "string"
      ? renamed.type
      : typeof renamed.op === "string"
        ? renamed.op
        : typeof renamed.operation === "string"
          ? renamed.operation
          : undefined;
  if (rawType) {
    const mapped = OP_TYPE_ALIASES[rawType] ?? OP_TYPE_ALIASES[rawType.toLowerCase()];
    if (mapped) renamed.type = mapped;
    delete renamed.op;
    delete renamed.operation;
  }
  return renamed;
}

/**
 * Normalize command arguments before Zod validation.
 * Fixes common Agent mistakes: snake_case keys, op type aliases, nested ops.
 */
export function normalizeCommandArguments(
  command: string,
  args: unknown,
): Record<string, unknown> {
  let raw = parseMaybeJson(args);
  if (raw == null) raw = {};
  let obj = asObject(raw);
  if (!obj) {
    return { value: raw };
  }

  // Accidentally double-wrapped: { arguments: { ... } } or { input: { ... } }
  for (const wrap of ["arguments", "args", "input", "params"] as const) {
    if (wrap in obj && Object.keys(obj).length <= 2) {
      const inner = asObject(parseMaybeJson(obj[wrap]));
      if (inner) obj = inner;
    }
  }

  let normalized = coerceNumericFields(renameKeys(obj));

  // Empty / null optional numbers → omit (models often send startLine: null|"")
  for (const key of NUMERIC_KEYS) {
    const v = normalized[key];
    if (v === null || v === "" || (typeof v === "number" && Number.isNaN(v))) {
      delete normalized[key];
    }
  }

  if (command === "sandbox.applyOperations" || command.endsWith(".applyOperations")) {
    const ops = normalized.operations ?? normalized.ops ?? normalized.changes;
    if (Array.isArray(ops)) {
      normalized = {
        ...normalized,
        operations: ops.map(normalizeOperation),
      };
      delete normalized.ops;
      delete normalized.changes;
    }
  }

  return normalized;
}

export type CliExecuteRawInput = {
  command?: unknown;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
  params?: unknown;
  [key: string]: unknown;
};

/**
 * Accept both nested and flattened cli_execute calls:
 *
 * Nested (canonical):
 *   { command, arguments: { path, oldString, newString } }
 *
 * Flattened (common model mistake — still accepted):
 *   { command, path, oldString, newString }
 */
export function coerceCliExecuteInput(raw: CliExecuteRawInput): {
  command: string;
  arguments: Record<string, unknown>;
} {
  const command = typeof raw.command === "string" ? raw.command.trim() : "";

  const nestedCandidates = [raw.arguments, raw.args, raw.input, raw.params]
    .map(parseMaybeJson)
    .map(asObject)
    .filter((v): v is Record<string, unknown> => v != null);

  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_EXECUTE_KEYS.has(key)) continue;
    if (value === undefined) continue;
    flat[key] = value;
  }

  const merged: Record<string, unknown> = {
    ...flat,
    ...(nestedCandidates[0] ?? {}),
  };

  return {
    command,
    arguments: normalizeCommandArguments(command, merged),
  };
}
