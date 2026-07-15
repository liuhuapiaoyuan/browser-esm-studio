/** OpenAI-compatible API settings (browser localStorage). */

export type AiSettings = {
  baseURL: string;
  apiKey: string;
  model: string;
  /** Model context window in tokens. Compact triggers at 60% of this. */
  contextWindow: number;
};

const STORAGE_KEY = "browser-esm-studio-ai-settings-v1";

/** Default 256K context window. */
export const DEFAULT_CONTEXT_WINDOW = 256_000;

/** Compact when estimated tokens exceed this fraction of the context window. */
export const COMPACT_RATIO = 0.6;

const DEFAULTS: AiSettings = {
  baseURL: import.meta.env.VITE_AI_BASE_URL || "/openai-proxy/v1",
  apiKey: import.meta.env.VITE_AI_API_KEY || "abc",
  model: import.meta.env.VITE_AI_MODEL || "MiniMax-M2.7-highspeed",
  contextWindow: DEFAULT_CONTEXT_WINDOW,
};

function parseContextWindow(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 8_000) return DEFAULT_CONTEXT_WINDOW;
  return Math.floor(n);
}

export function compactThreshold(contextWindow: number = DEFAULT_CONTEXT_WINDOW): number {
  return Math.floor(parseContextWindow(contextWindow) * COMPACT_RATIO);
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      baseURL: String(parsed.baseURL || DEFAULTS.baseURL).trim() || DEFAULTS.baseURL,
      apiKey: String(parsed.apiKey ?? DEFAULTS.apiKey),
      model: String(parsed.model || DEFAULTS.model).trim() || DEFAULTS.model,
      contextWindow: parseContextWindow(parsed.contextWindow ?? DEFAULTS.contextWindow),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      baseURL: settings.baseURL.trim(),
      apiKey: settings.apiKey,
      model: settings.model.trim(),
      contextWindow: parseContextWindow(settings.contextWindow),
    }),
  );
}

export function isAiConfigured(settings: AiSettings = loadAiSettings()): boolean {
  return Boolean(settings.baseURL.trim() && settings.apiKey.trim() && settings.model.trim());
}
