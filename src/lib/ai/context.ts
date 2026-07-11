import { generateText, pruneMessages, type LanguageModel, type ModelMessage } from "ai";
import { compactThreshold, DEFAULT_CONTEXT_WINDOW } from "./settings";

export type HistoryTurn = {
  role: "user" | "assistant";
  text: string;
};

/** Rough token estimate (chars/4). Good enough for compaction triggers. */
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function historyTokens(summary: string | undefined, turns: HistoryTurn[]): number {
  const chars =
    (summary?.length ?? 0) +
    turns.reduce((sum, turn) => sum + turn.role.length + turn.text.length + 2, 0);
  return Math.ceil(chars / 4);
}

/** Keep this many recent turns verbatim after summarization. */
export const HISTORY_KEEP_RECENT = 6;

/**
 * Estimate tokens the next agent turn will send (system + project + compacted history + draft).
 * Mirrors prepareHistoryContext's "what the model sees" for the history portion.
 */
export function estimateOutgoingContextTokens(options: {
  history: HistoryTurn[];
  summary?: string;
  prompt?: string;
  fixedTokens?: number;
}): number {
  const turns = options.history.filter((turn) => turn.text.trim().length > 0);
  const previous = options.summary?.trim() || undefined;
  const historyPart = previous
    ? historyTokens(previous, turns.slice(-(HISTORY_KEEP_RECENT + 4)))
    : historyTokens(undefined, turns);
  return historyPart + estimateTextTokens(options.prompt ?? "") + (options.fixedTokens ?? 0);
}

function toolResultMaxChars(contextWindow: number): number {
  // ~2% of the window as chars (tokens*4), floor at 8k so tiny windows still work.
  return Math.max(8_000, Math.floor(contextWindow * 0.02 * 4));
}

function truncateString(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** Shrink oversized tool outputs before they dominate the loop context. */
export function truncateLargeToolResults(
  messages: ModelMessage[],
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): ModelMessage[] {
  const maxChars = toolResultMaxChars(contextWindow);
  let changed = false;
  const next = messages.map((message) => {
    if (message.role !== "tool") return message;
    let messageChanged = false;
    const content = message.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const serialized = JSON.stringify(part.output);
      if (serialized.length <= maxChars) return part;
      messageChanged = true;
      return {
        ...part,
        output: {
          type: "json" as const,
          value: {
            truncated: true,
            toolName: part.toolName,
            preview: truncateString(serialized, maxChars),
          },
        },
      };
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, content };
  });
  return changed ? next : messages;
}

/**
 * AI SDK context compaction for ToolLoopAgent / generateText prepareStep.
 * Triggers at 60% of the configured model context window.
 * @see https://ai-sdk.dev/cookbook/guides/agent-context-compaction
 */
export function compactLoopMessages(
  messages: ModelMessage[],
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
  options?: { force?: boolean },
): ModelMessage[] | undefined {
  const threshold = compactThreshold(contextWindow);
  const truncated = truncateLargeToolResults(messages, contextWindow);
  const overBudget = options?.force || estimateTokens(truncated) > threshold;
  if (!overBudget) {
    return truncated === messages ? undefined : truncated;
  }
  return pruneMessages({
    messages: truncated,
    reasoning: "all",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  });
}

function formatTurns(turns: HistoryTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n");
}

export function formatHistoryBlock(
  summary: string | undefined,
  recent: HistoryTurn[],
): string {
  const parts: string[] = [];
  if (summary?.trim()) {
    parts.push(`Conversation summary (earlier turns):\n${summary.trim()}`);
  }
  if (recent.length) {
    parts.push(`Recent conversation:\n${formatTurns(recent)}`);
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}

async function summarizeTurns(
  model: LanguageModel,
  previousSummary: string | undefined,
  older: HistoryTurn[],
  abortSignal?: AbortSignal,
): Promise<string> {
  const { text } = await generateText({
    model,
    abortSignal,
    temperature: 0.2,
    instructions: `You compress coding-agent chat history into a durable working memory.
Keep: user goals, decisions, constraints, files/features already changed, open issues, and anything needed for follow-ups.
Drop: fluff, repeated tool chatter, full code dumps.
Write concise Chinese bullet points (max ~400 words).`,
    prompt: [
      previousSummary?.trim() ? `Existing summary:\n${previousSummary.trim()}` : "",
      `Turns to fold in:\n${formatTurns(older)}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return text.trim() || previousSummary?.trim() || formatTurns(older).slice(0, 800);
}

export type PreparedHistory = {
  /** Prompt fragment injected into planner/executor. */
  block: string;
  /** Updated rolling summary for the next turn (may be unchanged). */
  summary: string | undefined;
  /** True when a new LLM summary was produced. */
  compacted: boolean;
};

/**
 * Cross-turn history management: keep recent turns + rolling summary of older ones.
 * Compacts when history tokens exceed 60% of the model context window.
 */
export async function prepareHistoryContext(options: {
  history: HistoryTurn[] | undefined;
  previousSummary?: string;
  model: LanguageModel;
  contextWindow?: number;
  abortSignal?: AbortSignal;
}): Promise<PreparedHistory> {
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const threshold = compactThreshold(contextWindow);
  const turns = (options.history ?? []).filter((turn) => turn.text.trim().length > 0);
  const previous = options.previousSummary?.trim() || undefined;

  if (!turns.length && !previous) {
    return { block: "", summary: undefined, compacted: false };
  }

  // Already compacted: model only sees summary + a live tail from the UI transcript.
  if (previous) {
    const live = turns.slice(-(HISTORY_KEEP_RECENT + 4));
    if (historyTokens(previous, live) <= threshold) {
      return {
        block: formatHistoryBlock(previous, live),
        summary: previous,
        compacted: false,
      };
    }
    const recent = live.slice(-HISTORY_KEEP_RECENT);
    const older = live.slice(0, -HISTORY_KEEP_RECENT);
    if (!older.length) {
      return {
        block: formatHistoryBlock(previous, recent),
        summary: previous,
        compacted: false,
      };
    }
    const summary = await summarizeTurns(options.model, previous, older, options.abortSignal);
    return {
      block: formatHistoryBlock(summary, recent),
      summary,
      compacted: true,
    };
  }

  if (turns.length <= HISTORY_KEEP_RECENT || historyTokens(undefined, turns) <= threshold) {
    return {
      block: formatHistoryBlock(undefined, turns),
      summary: undefined,
      compacted: false,
    };
  }

  const recent = turns.slice(-HISTORY_KEEP_RECENT);
  const older = turns.slice(0, -HISTORY_KEEP_RECENT);
  // Cap summarizer input to the compact threshold so the summary call itself fits.
  let budget = 0;
  const capped: HistoryTurn[] = [];
  for (let i = older.length - 1; i >= 0; i -= 1) {
    budget += estimateTextTokens(older[i].text);
    capped.unshift(older[i]);
    if (budget > threshold) break;
  }
  const summary = await summarizeTurns(options.model, undefined, capped, options.abortSignal);
  return {
    block: formatHistoryBlock(summary, recent),
    summary,
    compacted: true,
  };
}
