import { normalizePath } from "../../../path";
import type { Sandbox } from "../../../sandbox";
import { AgentCliCommandError } from "../../protocol";
import { getSfxById, type SfxEntry } from "./catalog";

export const SFX_MANIFEST_PATH = "src/assets/sfx/manifest.json";
export const SFX_DEFAULT_DIR = "src/assets/sfx";

function writeText(sandbox: Sandbox, path: string, content: string): void {
  if (sandbox.exists(path)) sandbox.write(path, content);
  else sandbox.add(path, content);
}

export function buildSfxUrlModule(entry: SfxEntry): string {
  const escaped = JSON.stringify(entry.url);
  const comment = `${entry.name} (${entry.id})`.replace(/\*\//g, "* /");
  return `/** Teaching SFX: ${comment} */
export default ${escaped};
`;
}

export function defaultSfxModulePath(id: string): string {
  return `${SFX_DEFAULT_DIR}/${id}.ts`;
}

function readSfxManifest(sandbox: Sandbox): Record<string, string> {
  if (!sandbox.exists(SFX_MANIFEST_PATH)) return {};
  try {
    const parsed = JSON.parse(sandbox.read(SFX_MANIFEST_PATH)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function upsertSfxManifest(
  sandbox: Sandbox,
  entries: Array<{ path: string; url: string; id: string }>,
): void {
  const manifest = readSfxManifest(sandbox);
  for (const entry of entries) {
    manifest[entry.path] = entry.url;
    manifest[`id:${entry.id}`] = entry.url;
  }
  writeText(sandbox, SFX_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export type MappedSfx = {
  id: string;
  name: string;
  path: string;
  url: string;
};

export function resolveSfxEntry(id: string): SfxEntry {
  const entry = getSfxById(id);
  if (!entry) {
    throw new AgentCliCommandError("RESOURCE_NOT_FOUND", `未知音效 id: ${id}`, {
      retryable: false,
      field: "/ids",
      suggestions: ["先用 sfx.list 查看可用 id（如 correct、wrong、click）"],
    });
  }
  return entry;
}

export function writeSfxUrlModule(
  sandbox: Sandbox,
  entry: SfxEntry,
  path?: string,
): MappedSfx {
  const target = normalizePath(path ?? defaultSfxModulePath(entry.id));
  if (!target) {
    throw new AgentCliCommandError("INVALID_ARGUMENT", "path 不能为空", {
      retryable: false,
      field: "/path",
    });
  }
  if (!/\.tsx?$/i.test(target)) {
    throw new AgentCliCommandError(
      "INVALID_ARGUMENT",
      "path 须为 .ts / .tsx（仅写入 URL 字符串模块）",
      { retryable: false, field: "/path" },
    );
  }

  writeText(sandbox, target, buildSfxUrlModule(entry));
  return { id: entry.id, name: entry.name, path: target, url: entry.url };
}

export function mapSfxIds(
  sandbox: Sandbox,
  ids: string[],
  paths?: string[],
): MappedSfx[] {
  if (!ids.length) {
    throw new AgentCliCommandError("INVALID_ARGUMENT", "ids 不能为空", {
      retryable: false,
      field: "/ids",
    });
  }
  if (paths && paths.length !== ids.length) {
    throw new AgentCliCommandError(
      "INVALID_ARGUMENT",
      "paths 长度须与 ids 一致",
      { retryable: false, field: "/paths" },
    );
  }

  const mapped: MappedSfx[] = [];
  for (let i = 0; i < ids.length; i++) {
    const entry = resolveSfxEntry(ids[i]!);
    mapped.push(writeSfxUrlModule(sandbox, entry, paths?.[i]));
  }
  upsertSfxManifest(
    sandbox,
    mapped.map((item) => ({ path: item.path, url: item.url, id: item.id })),
  );
  return mapped;
}
