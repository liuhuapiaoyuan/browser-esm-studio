import {
  LiteSpeechGenerateError,
  type LiteSpeechGenerateResult,
} from "../../../../service/lite-speech-generate";
import { normalizePath } from "../../../path";
import type { Sandbox } from "../../../sandbox";
import { AgentCliCommandError } from "../../protocol";

export const SPEECH_MANIFEST_PATH = "src/assets/generated/audio/manifest.json";

/** Soft cap so data-URL modules do not blow localStorage. */
export const SPEECH_MAX_AUDIO_BYTES = 400_000;

export function mapLiteSpeechError(e: unknown): never {
  if (e instanceof AgentCliCommandError) throw e;
  if (e instanceof LiteSpeechGenerateError) {
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function audioToDataUrl(result: LiteSpeechGenerateResult): string {
  if (result.audio.byteLength > SPEECH_MAX_AUDIO_BYTES) {
    throw new AgentCliCommandError(
      "OUTPUT_TOO_LARGE",
      `音频过大（${result.audio.byteLength} bytes），请缩短 input 后重试`,
      {
        retryable: true,
        suggestions: ["缩短合成文本（建议单句/短段讲解）", "降低 sampleRate 或改用 mp3"],
      },
    );
  }
  return `data:${result.mimeType};base64,${arrayBufferToBase64(result.audio)}`;
}

function buildUrlModule(url: string, text: string): string {
  const escaped = JSON.stringify(url);
  const comment = text.trim().slice(0, 120).replace(/\*\//g, "* /");
  return `/** Generated speech URL mapping. Text: ${comment} */
export default ${escaped};
`;
}

export function defaultSpeechModulePath(text: string): string {
  const slug = slugify(text).slice(0, 40) || "speech";
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `src/assets/generated/audio/${slug}-${stamp}.ts`;
}

function slugify(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[\u4e00-\u9fff]+/g, "speech")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || "speech";
}

function writeText(sandbox: Sandbox, path: string, content: string): void {
  if (sandbox.exists(path)) sandbox.write(path, content);
  else sandbox.add(path, content);
}

export function writeSpeechUrlModule(
  sandbox: Sandbox,
  path: string,
  url: string,
  text: string,
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
      "path 须为 .ts / .tsx（仅写入 URL 字符串模块）",
      { retryable: false, field: "/path" },
    );
  }

  writeText(sandbox, normalized, buildUrlModule(url, text));
  return normalized;
}

function readSpeechManifest(sandbox: Sandbox): Record<string, string> {
  if (!sandbox.exists(SPEECH_MANIFEST_PATH)) return {};
  try {
    const parsed = JSON.parse(sandbox.read(SPEECH_MANIFEST_PATH)) as unknown;
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

export function upsertSpeechManifest(
  sandbox: Sandbox,
  entries: Array<{ path: string; url: string }>,
): void {
  const manifest = readSpeechManifest(sandbox);
  for (const entry of entries) {
    manifest[entry.path] = entry.url;
  }
  writeText(sandbox, SPEECH_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export type MappedSpeech = {
  path: string;
  url: string;
};

export function mapGeneratedSpeech(
  sandbox: Sandbox,
  result: LiteSpeechGenerateResult,
  options: { input: string; path?: string },
): MappedSpeech {
  const url = audioToDataUrl(result);
  const target = options.path
    ? normalizePath(options.path)
    : defaultSpeechModulePath(options.input);
  const path = writeSpeechUrlModule(sandbox, target, url, options.input);
  upsertSpeechManifest(sandbox, [{ path, url }]);
  return { path, url };
}
