import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { extractReasoningMiddleware, wrapLanguageModel, type LanguageModel } from "ai";
import { loadAiSettings, type AiSettings } from "./settings";

export function createLanguageModel(settings: AiSettings = loadAiSettings()): LanguageModel {
  const baseURL = settings.baseURL.replace(/\/+$/, "");
  // Default: no json_schema structured outputs — most ChatGPT-compatible proxies lack it.
  // Planner uses tool calling instead; leave supportsStructuredOutputs unset (false).
  const provider = createOpenAICompatible({
    name: "custom",
    apiKey: settings.apiKey,
    baseURL,
  });
  return wrapLanguageModel({
    model: provider.chatModel(settings.model),
    middleware: extractReasoningMiddleware({
      tagName: "think",
      separator: "\n\n",
    }),
  });
}
