import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  extractReasoningMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { loadAiSettings, type AiSettings } from "./settings";

/**
 * MiniMax Interleaved Thinking (M2.x / M3):
 * After a tool round, the assistant message must still contain the original
 * `<think>…</think>` block in `content`. extractReasoningMiddleware strips it
 * into `reasoning` parts for the UI; this middleware puts it back before the
 * next request so the thinking chain is not broken.
 */
function preserveThinkTagsMiddleware(): LanguageModelMiddleware {
  return {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const prompt = params.prompt.map((message) => {
        if (message.role !== "assistant" || !Array.isArray(message.content)) {
          return message;
        }

        const reasoningTexts = message.content
          .filter(
            (part): part is { type: "reasoning"; text: string } =>
              part.type === "reasoning" && typeof (part as { text?: unknown }).text === "string",
          )
          .map((part) => part.text.trim())
          .filter(Boolean);
        if (!reasoningTexts.length) return message;

        const rest = message.content.filter((part) => part.type !== "reasoning");
        const alreadyTagged = rest.some(
          (part) => part.type === "text" && part.text.includes("<think>"),
        );
        if (alreadyTagged) return { ...message, content: rest };

        const block = `<think>\n${reasoningTexts.join("\n\n")}\n</think>\n\n`;
        const textIndex = rest.findIndex((part) => part.type === "text");
        if (textIndex >= 0) {
          const textPart = rest[textIndex] as { type: "text"; text: string };
          const next = [...rest];
          next[textIndex] = { ...textPart, text: block + textPart.text };
          return { ...message, content: next };
        }

        return {
          ...message,
          content: [{ type: "text" as const, text: block }, ...rest],
        };
      });

      return { ...params, prompt };
    },
  };
}

/**
 * `@ai-sdk/openai-compatible` builds endpoints with `new URL(baseURL + path)`,
 * which rejects same-origin relative paths like `/openai-proxy/v1`.
 */
function resolveAiBaseURL(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  try {
    const origin =
      typeof globalThis !== "undefined" && "location" in globalThis && globalThis.location?.origin
        ? globalThis.location.origin
        : "http://localhost";
    return new URL(trimmed, origin).href.replace(/\/+$/, "");
  } catch {
    return trimmed;
  }
}

export function createLanguageModel(settings: AiSettings = loadAiSettings()): LanguageModel {
  const baseURL = resolveAiBaseURL(settings.baseURL);
  // Default: no json_schema structured outputs — most ChatGPT-compatible proxies lack it.
  // Planner uses tool calling instead; leave supportsStructuredOutputs unset (false).
  const provider = createOpenAICompatible({
    name: "custom",
    apiKey: settings.apiKey,
    baseURL,
    // Ask the provider for a final stream chunk with usage (prompt_tokens / …).
    // MiniMax & OpenAI-compatible APIs leave usage:null on intermediate chunks otherwise.
    includeUsage: true,
  });
  return wrapLanguageModel({
    model: provider.chatModel(settings.model),
    middleware: [
      preserveThinkTagsMiddleware(),
      extractReasoningMiddleware({
        tagName: "think",
        separator: "\n\n",
      }),
    ],
  });
}
