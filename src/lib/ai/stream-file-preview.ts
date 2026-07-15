/** Decode a JSON string value starting at `start` (first char after opening quote). */
export function decodeJsonStringValue(raw: string, start: number): string {
  let i = start;
  let out = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') break;
    if (c === "\\") {
      if (i + 1 >= raw.length) break;
      const n = raw[i + 1];
      if (n === "u") {
        if (i + 5 >= raw.length) break;
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

export function extractJsonStringField(raw: string, field: string): string | undefined {
  const key = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!key || key.index == null) return undefined;
  return decodeJsonStringValue(raw, key.index + key[0].length);
}

const ARG_BAG_KEYS = ["arguments", "args", "input", "params"] as const;
const PATH_KEYS = ["path", "file", "filepath", "filePath"] as const;
const BODY_KEYS = ["newString", "new_string", "content", "oldString", "old_string"] as const;

const FILE_BODY_CLI_RE = /sandbox\.(writeFile|addFile|replaceInFile)/;

export function isCliFileBodyRaw(raw: string): boolean {
  return FILE_BODY_CLI_RE.test(raw);
}

function firstStringField(source: string, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = extractJsonStringField(source, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function fieldsFromPartialJson(source: string): { path?: string; content?: string } {
  return {
    path: firstStringField(source, PATH_KEYS),
    content: firstStringField(source, BODY_KEYS),
  };
}

function mergeFields(
  ...parts: Array<{ path?: string; content?: string }>
): { path?: string; content?: string } {
  let path: string | undefined;
  let content: string | undefined;
  for (const part of parts) {
    if (part.path !== undefined && part.path.length > (path?.length ?? -1)) path = part.path;
    if (part.content !== undefined && part.content.length > (content?.length ?? -1)) {
      content = part.content;
    }
  }
  return { path, content };
}

/**
 * Some OpenAI-compatible providers (including certain MiniMax gateways) resend the
 * full arguments buffer on every chunk instead of a true append delta.
 * Detect that and keep a single coherent JSON prefix.
 */
export function appendToolArgDelta(raw: string, delta: string): string {
  if (!delta) return raw;
  if (!raw) return delta;
  if (delta.startsWith(raw)) return delta;
  if (raw.startsWith(delta)) return raw;
  return raw + delta;
}

/**
 * Pull path + body from partial tool-call JSON (write content / replace newString).
 * Handles flattened, nested-object, and stringified `arguments` bags used by cli_execute.
 */
export function extractStreamingFileFields(raw: string): { path?: string; content?: string } {
  const direct = fieldsFromPartialJson(raw);

  // Always unwrap stringified bags — a top-level path must not skip nested content.
  // e.g. {"command":"…","path":"a.tsx","arguments":"{\"content\":\"…"}
  let fromBag: { path?: string; content?: string } = {};
  for (const key of ARG_BAG_KEYS) {
    const inner = extractJsonStringField(raw, key);
    if (inner === undefined || inner.length === 0) continue;
    const nested = fieldsFromPartialJson(inner);
    if (nested.path !== undefined || nested.content !== undefined) {
      fromBag = nested;
      break;
    }
  }

  return mergeFields(direct, fromBag);
}
