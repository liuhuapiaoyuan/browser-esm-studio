import { normalizePath } from "./path";
import type { Sandbox } from "./sandbox";
import { SandboxError } from "./sandbox";

export const REFERENCES_DIR = "references";

/** Soft warning threshold — localStorage is typically ~5MB. */
export const REFERENCE_SIZE_WARN_BYTES = 1_500_000;

const HTML_EXT_RE = /\.html?$/i;

export function isHtmlReferenceName(name: string): boolean {
  return HTML_EXT_RE.test(name.trim());
}

/** Sanitize a user filename into `references/<safe>.html`. */
export function buildReferencePath(fileName: string): string {
  const base = normalizePath(fileName).split("/").pop() || "reference.html";
  const stripped = base.replace(/[^\w.\u4e00-\u9fff()-]+/g, "_").replace(/_+/g, "_");
  const withExt = HTML_EXT_RE.test(stripped) ? stripped : `${stripped || "reference"}.html`;
  return normalizePath(`${REFERENCES_DIR}/${withExt}`);
}

export function listReferenceHtmlPaths(sandbox: Sandbox): string[] {
  return sandbox
    .list()
    .filter((path) => path.startsWith(`${REFERENCES_DIR}/`) && isHtmlReferenceName(path))
    .sort();
}

export type ImportReferenceResult =
  | { ok: true; path: string; overwritten: boolean; bytes: number }
  | { ok: false; error: string };

/** Write HTML text into the virtual project under `references/`. */
export function importReferenceHtml(
  sandbox: Sandbox,
  fileName: string,
  content: string,
  options: { overwrite?: boolean } = {},
): ImportReferenceResult {
  if (!isHtmlReferenceName(fileName)) {
    return { ok: false, error: "仅支持 .html / .htm 文件" };
  }

  const path = buildReferencePath(fileName);
  const exists = sandbox.exists(path);
  if (exists && options.overwrite === false) {
    return { ok: false, error: `${path} 已存在` };
  }

  try {
    if (exists) sandbox.write(path, content);
    else sandbox.add(path, content);
    return { ok: true, path, overwritten: exists, bytes: content.length };
  } catch (error) {
    if (error instanceof SandboxError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
