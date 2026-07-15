import {
  LiteImageGenerateError,
  type LiteImageGenerateResult,
} from "../../../../service/lite-image-generate";
import { normalizePath } from "../../../path";
import type { Sandbox } from "../../../sandbox";
import { AgentCliCommandError } from "../../protocol";

const HTTP_URL_RE = /^https?:\/\//i;
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

export const IMAGE_MANIFEST_PATH = "src/assets/generated/manifest.json";

export function mapLiteImageError(e: unknown): never {
  if (e instanceof AgentCliCommandError) throw e;
  if (e instanceof LiteImageGenerateError) {
    const code =
      e.status === 401 || e.status === 403
        ? "AUTH_REQUIRED"
        : e.status === 404
          ? "RESOURCE_NOT_FOUND"
          : e.status === 429
            ? "RATE_LIMITED"
            : e.status >= 500
              ? "PROCESS_FAILED"
              : e.status === 400
                ? "INVALID_ARGUMENT"
                : "PROCESS_FAILED";
    throw new AgentCliCommandError(code, e.message, {
      retryable: e.status >= 500 || e.status === 429,
      details: { status: e.status, body: e.body, traceId: e.traceId },
      suggestions:
        code === "AUTH_REQUIRED"
          ? ["在 .env 配置 LITE_IMAGE_API_KEY 或 SILICONFLOW_API_KEY，并重启 bun run dev"]
          : undefined,
    });
  }
  throw new AgentCliCommandError(
    "INTERNAL_ERROR",
    e instanceof Error ? e.message : String(e),
    { retryable: false },
  );
}

/** Resolve image / image2 / image3: http(s), data URL, or sandbox path (module / manifest). */
export function resolveImageRef(sandbox: Sandbox, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (HTTP_URL_RE.test(trimmed) || DATA_URL_RE.test(trimmed)) return trimmed;

  const path = normalizePath(trimmed);
  if (!sandbox.exists(path)) {
    throw new AgentCliCommandError("RESOURCE_NOT_FOUND", `参考图文件不存在: ${path}`, {
      retryable: true,
      field: "/image",
      suggestions: [
        "用 sandbox.listFiles 确认路径，或传入 https URL / data:image/...;base64,...",
      ],
    });
  }

  const content = sandbox.read(path).trim();
  if (HTTP_URL_RE.test(content) || DATA_URL_RE.test(content)) return content;

  const moduleMatch = content.match(
    /export\s+default\s+["'`]((?:https?:\/\/|data:image\/)[^"'`]+)["'`]/i,
  );
  if (moduleMatch?.[1]) return moduleMatch[1].trim();

  throw new AgentCliCommandError(
    "INVALID_ARGUMENT",
    `无法将 ${path} 解析为参考图（需要 https URL、data URL，或 export default URL 的模块）`,
    { retryable: false, field: "/image" },
  );
}

export function buildUrlModule(url: string, prompt: string): string {
  const escaped = JSON.stringify(url);
  const comment = prompt.trim().slice(0, 120).replace(/\*\//g, "* /");
  return `/** Generated image URL mapping. Prompt: ${comment} */
export default ${escaped};
`;
}

export function defaultImageModulePath(prompt: string, index: number, total: number): string {
  const slug = slugify(prompt).slice(0, 40) || "image";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = total > 1 ? `-${index + 1}` : "";
  return `src/assets/generated/${slug}-${stamp}${suffix}.ts`;
}

function slugify(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "img")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "image";
}

function writeText(sandbox: Sandbox, path: string, content: string): void {
  if (sandbox.exists(path)) sandbox.write(path, content);
  else sandbox.add(path, content);
}

export function writeUrlModule(
  sandbox: Sandbox,
  path: string,
  url: string,
  prompt: string,
): string {
  const normalized = normalizePath(path);
  if (!normalized) {
    throw new AgentCliCommandError("INVALID_ARGUMENT", "path 不能为空", {
      retryable: false,
      field: "/path",
    });
  }
  if (!/\.tsx?$/i.test(normalized)) {
    throw new AgentCliCommandError(
      "INVALID_ARGUMENT",
      "path 须为 .ts / .tsx（仅写入 URL 字符串模块，不下载图片）",
      { retryable: false, field: "/path" },
    );
  }

  writeText(sandbox, normalized, buildUrlModule(url, prompt));
  return normalized;
}

export function readImageManifest(sandbox: Sandbox): Record<string, string> {
  if (!sandbox.exists(IMAGE_MANIFEST_PATH)) return {};
  try {
    const parsed = JSON.parse(sandbox.read(IMAGE_MANIFEST_PATH)) as unknown;
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

export function upsertImageManifest(
  sandbox: Sandbox,
  entries: Array<{ path: string; url: string }>,
): Record<string, string> {
  const manifest = readImageManifest(sandbox);
  for (const entry of entries) {
    manifest[entry.path] = entry.url;
  }
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  writeText(sandbox, IMAGE_MANIFEST_PATH, body);
  return manifest;
}

export type MappedImage = {
  path: string;
  url: string;
};

/** Map generated image URLs into sandbox (modules + manifest). Never downloads bytes. */
export function mapGeneratedImages(
  sandbox: Sandbox,
  result: LiteImageGenerateResult,
  options: {
    prompt: string;
    path?: string;
  },
): MappedImage[] {
  const total = result.images.length;
  const mapped: MappedImage[] = [];

  for (let i = 0; i < total; i += 1) {
    const url = result.images[i]!.url;
    const target =
      options.path && total === 1
        ? normalizePath(options.path)
        : options.path && total > 1
          ? injectIndex(normalizePath(options.path), i + 1)
          : defaultImageModulePath(options.prompt, i, total);

    const path = writeUrlModule(sandbox, target, url, options.prompt);
    mapped.push({ path, url });
  }

  upsertImageManifest(sandbox, mapped);
  return mapped;
}

function injectIndex(path: string, index: number): string {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) return `${path}-${index}`;
  return `${path.slice(0, dot)}-${index}${path.slice(dot)}`;
}
