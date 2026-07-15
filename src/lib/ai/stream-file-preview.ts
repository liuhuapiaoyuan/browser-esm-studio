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

const FILE_BODY_CLI_RE = /sandbox\.(writeFile|addFile|replaceInFile)/;

export function isCliFileBodyRaw(raw: string): boolean {
  return FILE_BODY_CLI_RE.test(raw);
}

function fieldsFromPartialJson(source: string): { path?: string; content?: string } {
  const path = extractJsonStringField(source, "path");
  const content =
    extractJsonStringField(source, "newString") ??
    extractJsonStringField(source, "content") ??
    extractJsonStringField(source, "oldString");
  return { path, content };
}

/**
 * Pull path + body from partial tool-call JSON (write content / replace newString).
 * Handles flattened, nested-object, and stringified `arguments` bags used by cli_execute.
 */
export function extractStreamingFileFields(raw: string): { path?: string; content?: string } {
  const direct = fieldsFromPartialJson(raw);
  if (direct.path !== undefined || direct.content !== undefined) return direct;

  // Models often pass arguments as a JSON string:
  // {"command":"sandbox.addFile","arguments":"{\"path\":\"…\",\"content\":\"…"}
  // Nested keys are escaped, so unwrap the bag first.
  for (const key of ARG_BAG_KEYS) {
    const inner = extractJsonStringField(raw, key);
    if (inner === undefined || inner.length === 0) continue;
    const nested = fieldsFromPartialJson(inner);
    if (nested.path !== undefined || nested.content !== undefined) return nested;
  }

  return direct;
}
