import { APICallError, isStepCount, streamText, tool, ToolLoopAgent } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox";
import type { AgentToolActivity } from "../../types";
import { createLanguageModel } from "./provider";
import { createSandboxTools } from "./sandboxTools";
import { isAiConfigured, loadAiSettings, type AiSettings } from "./settings";

const planSchema = z.object({
  summary: z.string().describe("One-sentence plan summary for the user"),
  steps: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        detail: z.string().describe("What to change and why"),
        files: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(12),
});

export type AgentPlan = z.infer<typeof planSchema>;

export type AgentProgress =
  | { type: "planning" }
  | { type: "planned"; plan: AgentPlan }
  | { type: "executing" }
  | { type: "reasoning-start" }
  | { type: "reasoning-delta"; delta: string }
  | { type: "reasoning-end" }
  | { type: "tool"; tool: AgentToolActivity }
  | { type: "text-delta"; delta: string }
  | { type: "done" };

export type AgentChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export type AgentResult = {
  reply: string;
  reasoning: string;
  changed: string[];
  plan: AgentPlan;
};

const RUNTIME_RULES = `You are editing a pure-frontend virtual project previewed in the browser.

Hard constraints:
- There is NO Node server and NO local node_modules at runtime.
- Dependencies must be declared in package.json; Preview resolves them via esm.sh import maps.
- Prefer TypeScript / TSX. Paths are relative (e.g. src/App.tsx), never absolute.
- index.html and package.json cannot be deleted.
- Mutate files ONLY via the provided Sandbox tools.
- Keep changes minimal and coherent with the existing design.
- Preview runs at /__preview__/{sessionId}/index.html. If the app needs client-side routing, use HashRouter (or MemoryRouter). NEVER use BrowserRouter / createBrowserRouter — pathname will be the preview URL and routes will not match.
- After edits, briefly confirm what changed.`;

function projectContext(sandbox: Sandbox): string {
  const files = sandbox.list();
  const packageJson = sandbox.exists("package.json") ? sandbox.read("package.json") : "(missing)";
  return `Current files (${files.length}):\n${files.map((f) => `- ${f}`).join("\n")}\n\npackage.json:\n${packageJson}`;
}

function collectChangedPaths(
  sandbox: Sandbox,
  before: Set<string>,
  beforeContents: Map<string, string>,
): string[] {
  const after = sandbox.list();
  const changed = new Set<string>();
  for (const path of after) {
    if (!before.has(path) || beforeContents.get(path) !== sandbox.read(path)) {
      changed.add(path);
    }
  }
  for (const path of before) {
    if (!sandbox.exists(path)) changed.add(path);
  }
  return [...changed].sort();
}

function formatHistory(history: AgentChatTurn[] | undefined): string {
  if (!history?.length) return "";
  const recent = history.slice(-8);
  return `\n\nRecent conversation:\n${recent
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n")}`;
}

function formatPreviewErrors(errors: string[] | undefined): string {
  if (!errors?.length) return "";
  return `\n\nRecent preview console errors (fix these if relevant):\n${errors
    .slice(-20)
    .map((line) => `- ${line}`)
    .join("\n")}`;
}

export function formatAgentError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode ? `HTTP ${error.statusCode}` : "API error";
    const body =
      typeof error.responseBody === "string" && error.responseBody.trim()
        ? error.responseBody.trim().slice(0, 400)
        : error.message;
    return `${status}: ${body}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function toolDetail(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const values = input as Record<string, unknown>;
  if (typeof values.path === "string") return values.path;
  if (typeof values.query === "string") return values.query.slice(0, 80);
  if (Array.isArray(values.operations)) return `${values.operations.length} 项操作`;
  return undefined;
}

export async function runPlanExecutorAgent(
  prompt: string,
  sandbox: Sandbox,
  options: {
    settings?: AiSettings;
    history?: AgentChatTurn[];
    previewErrors?: string[];
    onProgress?: (event: AgentProgress) => void;
    abortSignal?: AbortSignal;
  } = {},
): Promise<AgentResult> {
  const settings = options.settings ?? loadAiSettings();
  if (!isAiConfigured(settings)) {
    throw new Error("请先配置 API Base URL、API Key 和 Model。");
  }

  const model = createLanguageModel(settings);
  const historyBlock = formatHistory(options.history);
  const previewErrorBlock = formatPreviewErrors(options.previewErrors);
  const before = new Set(sandbox.list());
  const snapshot = new Map<string, string>();
  for (const path of before) snapshot.set(path, sandbox.read(path));

  options.onProgress?.({ type: "planning" });

  // Stream planner; force submitPlan tool for ChatGPT-compatible APIs without json_schema.
  const planStream = streamText({
    model,
    abortSignal: options.abortSignal,
    tools: {
      submitPlan: tool({
        description: "Submit the final implementation plan. Call exactly once.",
        inputSchema: planSchema,
        execute: async (plan) => plan,
      }),
    },
    toolChoice: { type: "tool", toolName: "submitPlan" },
    instructions: `${RUNTIME_RULES}

You are the Planner. Call submitPlan with a concrete, ordered implementation plan.
Do not write code yet. Prefer small steps that map to Sandbox tool calls.
Inspect the file list and package.json context carefully.
If preview console errors are provided, prioritize fixing them when the user asks to fix bugs or the errors block the request.`,
    prompt: `User request:\n${prompt}${historyBlock}${previewErrorBlock}\n\nProject context:\n${projectContext(sandbox)}`,
  });

  const planToolResults = await planStream.toolResults;
  const planOutput = planToolResults.find(
    (result) => result.toolName === "submitPlan" && result.type === "tool-result",
  )?.output;

  const plan = planSchema.safeParse(planOutput);
  if (!plan.success) {
    throw new Error("Planner 未返回有效计划。请确认模型支持 function/tool calling。");
  }

  options.onProgress?.({ type: "planned", plan: plan.data });
  options.onProgress?.({ type: "executing" });

  const tools = createSandboxTools(sandbox);
  const executor = new ToolLoopAgent({
    model,
    instructions: `${RUNTIME_RULES}

You are the Executor. Implement the given plan using Sandbox tools.
Workflow:
1. listFiles / readFile / grep to inspect before writing.
   - Prefer grep with fuzzy=true when the exact symbol/string is uncertain.
   - Use glob (e.g. **/*.{ts,tsx}) to narrow search; regex=true for precise patterns.
2. Prefer replaceInFile for surgical edits; writeFile/addFile for new or full rewrites.
3. Use applyOperations for multi-file atomic batches.
4. When done, reply with a short Chinese summary of what you changed.`,
    tools,
    stopWhen: isStepCount(40),
    onToolExecutionStart({ toolCall }) {
      options.onProgress?.({
        type: "tool",
        tool: {
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          detail: toolDetail(toolCall.input),
          status: "running",
        },
      });
    },
    onToolExecutionEnd({ toolCall, toolOutput, toolExecutionMs }) {
      let error: string | undefined;
      if (toolOutput.type === "tool-error") {
        error = formatAgentError(toolOutput.error);
      } else {
        const output = toolOutput.output;
        if (output && typeof output === "object" && "ok" in output && output.ok === false) {
          const message = "error" in output ? output.error : "工具执行失败";
          error = typeof message === "string" ? message : String(message);
        }
      }
      options.onProgress?.({
        type: "tool",
        tool: {
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          detail: toolDetail(toolCall.input),
          status: error ? "error" : "completed",
          durationMs: toolExecutionMs,
          error,
        },
      });
    },
  });

  const planText = [
    `Plan summary: ${plan.data.summary}`,
    ...plan.data.steps.map(
      (step, index) =>
        `${index + 1}. [${step.id}] ${step.title}\n   ${step.detail}${
          step.files?.length ? `\n   files: ${step.files.join(", ")}` : ""
        }`,
    ),
  ].join("\n");

  // Re-read project after planning so executor sees any concurrent UI edits.
  const result = await executor.stream({
    abortSignal: options.abortSignal,
    prompt: `User request:\n${prompt}${historyBlock}${previewErrorBlock}\n\n${planText}\n\nProject context:\n${projectContext(sandbox)}\n\nExecute the plan now.`,
  });

  let reply = "";
  let reasoning = "";
  for await (const part of result.stream) {
    switch (part.type) {
      case "reasoning-start":
        options.onProgress?.({ type: "reasoning-start" });
        break;
      case "reasoning-delta":
        reasoning += part.text;
        options.onProgress?.({ type: "reasoning-delta", delta: part.text });
        break;
      case "reasoning-end":
        options.onProgress?.({ type: "reasoning-end" });
        break;
      case "text-delta":
        reply += part.text;
        options.onProgress?.({ type: "text-delta", delta: part.text });
        break;
      case "error":
        throw part.error;
    }
  }

  // Ensure stream errors / final state are surfaced.
  await result.text;

  options.onProgress?.({ type: "done" });

  return {
    reply: reply.trim() || plan.data.summary,
    reasoning: reasoning.trim(),
    changed: collectChangedPaths(sandbox, before, snapshot),
    plan: plan.data,
  };
}

export const AGENT_SUGGESTIONS = [
  "把主标题改得更有冲击力",
  "增加一个深色模式切换",
  "把特性区改成三列卡片布局",
  "汉化整个落地页",
];
