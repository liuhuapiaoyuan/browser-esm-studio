/** OpenAI-compatible API settings (browser localStorage). */

export type AiSettings = {
  baseURL: string;
  apiKey: string;
  model: string;
};

const STORAGE_KEY = "browser-esm-studio-ai-settings-v1";

const DEFAULTS: AiSettings = {
  baseURL: import.meta.env.VITE_AI_BASE_URL || "/openai-proxy/v1",
  apiKey: import.meta.env.VITE_AI_API_KEY || "",
  model: import.meta.env.VITE_AI_MODEL || "gpt-4o",
};

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      baseURL: String(parsed.baseURL || DEFAULTS.baseURL).trim() || DEFAULTS.baseURL,
      apiKey: String(parsed.apiKey ?? DEFAULTS.apiKey),
      model: String(parsed.model || DEFAULTS.model).trim() || DEFAULTS.model,
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
    }),
  );
}

export function isAiConfigured(settings: AiSettings = loadAiSettings()): boolean {
  return Boolean(settings.baseURL.trim() && settings.apiKey.trim() && settings.model.trim());
}
