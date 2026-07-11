import { APICallError, generateText, isStepCount, tool, ToolLoopAgent, type LanguageModelUsage } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox";
import type { AgentToolActivity } from "../../types";
import { compactLoopMessages, estimateTextTokens, prepareHistoryContext } from "./context";
import { createLanguageModel } from "./provider";
import { createSandboxTools } from "./sandboxTools";
import { createDdbTools } from "./ddbTools";
import { createSkillTools } from "./skillTools";
import { createTypecheckTools } from "./typecheckTools";
import { buildSkillsPromptSection } from "./skills/registry";
import { compactThreshold, isAiConfigured, loadAiSettings, type AiSettings } from "./settings";

const planStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string().describe("What to change and why"),
  files: z.array(z.string()).optional(),
});

const planSchema = z.object({
  summary: z.string().describe("One-sentence plan summary for the user"),
  steps: z.array(planStepSchema).min(1).max(12),
});

export type AgentPlan = z.infer<typeof planSchema>;

/** MiniMax often breaks nested streaming tool JSON — never block the agent on that. */
function fallbackPlan(userPrompt: string): AgentPlan {
  const summary = userPrompt.trim().slice(0, 160) || "实现用户请求";
  return {
    summary,
    steps: [{ id: "1", title: "实现请求", detail: summary }],
  };
}

function coercePlan(raw: unknown): AgentPlan | null {
  const direct = planSchema.safeParse(raw);
  if (direct.success) return direct.data;
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.plan != null) return coercePlan(obj.plan);
  if (!Array.isArray(obj.steps)) return null;

  const steps = obj.steps.map((step, index) => {
    if (!step || typeof step !== "object") {
      return {
        id: String(index + 1),
        title: String(step ?? `步骤 ${index + 1}`),
        detail: String(step ?? ""),
      };
    }
    const item = step as Record<string, unknown>;
    return {
      id: String(item.id ?? index + 1),
      title: String(item.title ?? item.name ?? `步骤 ${index + 1}`),
      detail: String(item.detail ?? item.description ?? item.title ?? ""),
      files: Array.isArray(item.files) ? item.files.map(String) : undefined,
    };
  });

  const coerced = planSchema.safeParse({
    summary: String(obj.summary ?? steps[0]?.title ?? "实现用户请求"),
    steps: steps.length
      ? steps
      : [{ id: "1", title: "实现请求", detail: String(obj.summary ?? "") }],
  });
  return coerced.success ? coerced.data : null;
}

export type AgentProgress =
  | { type: "compacting" }
  | { type: "planning" }
  | { type: "planned"; plan: AgentPlan }
  | { type: "executing" }
  | { type: "usage"; inputTokens: number; totalTokens?: number }
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

export type AgentUsage = {
  /** Latest provider-reported prompt tokens (context window pressure). */
  inputTokens: number;
  totalTokens?: number;
};

export type AgentResult = {
  reply: string;
  reasoning: string;
  changed: string[];
  plan: AgentPlan;
  /** Rolling summary of older chat turns for the next request. */
  conversationSummary?: string;
  /** Peak prompt tokens observed from the provider this turn. */
  usage?: AgentUsage;
};

function readInputTokens(usage: LanguageModelUsage | undefined): number | undefined {
  if (!usage) return undefined;
  if (typeof usage.inputTokens === "number" && Number.isFinite(usage.inputTokens)) {
    return usage.inputTokens;
  }
  // Some OpenAI-compatible proxies only return total_tokens.
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
    return usage.totalTokens;
  }
  return undefined;
}

const RUNTIME_RULES = `You are editing a pure-frontend virtual project previewed in the browser.

## Stack (always true — do not invent another stack)
- Language: TypeScript strict + React 19 (react-jsx). Files are \`.ts\` / \`.tsx\`.
- Bundler/runtime: Vite-style ESM preview. NO Node server, NO local node_modules at runtime.
- Deps: declare in package.json; Preview resolves via esm.sh import maps. Never assume npm install ran.
- Paths: \`@/\` → \`src/\`. Prefer \`@/...\` imports. Never use filesystem-absolute paths.
- Import extensions: match existing style — local/alias imports usually include \`.ts\` / \`.tsx\` (see tsconfig allowImportingTsExtensions). Mirror neighbors; do not drop extensions inconsistently.
- NOT Next.js / Remix / Expo: no \`next/*\`, no App Router, no RSC (\`"use client"\` unnecessary), no server actions, no \`process.env\` for secrets.
- Routing: entry already wraps with HashRouter. Use \`react-router-dom\` routes under hash. NEVER BrowserRouter / createBrowserRouter (Preview path is \`/__preview__/...\`).
- Three.js / R3F (React 19): use \`@react-three/fiber@^9\` + \`@react-three/drei@^10\` (+ \`three\`). NEVER fiber@8 / drei@9 — they target React 18 and crash with \`ReactCurrentBatchConfig\` via esm.sh.

## UI (shadcn new-york)
- Reuse ONLY components that already exist under \`src/components/ui/*\` (listed in project context). Import like \`@/components/ui/button.tsx\`.
- Class merging: \`import { cn } from "@/lib/utils.ts"\`.
- Icons: \`lucide-react\` only (already in package.json).
- Missing primitive: add under \`src/components/ui/\` in the same shadcn/Radix style, and add any new \`@radix-ui/*\` dep to package.json. Do not invent APIs for components that are not in the file list.
- Do not pull in other UI kits (MUI, Ant, Chakra, daisyUI, etc.).

## Styling (Tailwind CSS v4)
- Utilities + CSS variables / \`@theme inline\` tokens live in \`src/index.css\`.
- Use semantic tokens: \`bg-background\`, \`text-foreground\`, \`bg-primary\`, \`text-muted-foreground\`, \`border-border\`, etc.
- Preview injects \`@tailwindcss/browser\` — do NOT add PostCSS/tailwind.config.js Node build steps for Preview.
- No \`@apply\` sprawl; prefer utility classes in JSX. Do not assume Tailwind v3 \`tailwind.config.ts\` exists.

## TypeScript (strict — noImplicitAny)
- Callbacks must be typed when inference fails. Never leave bare \`(v) =>\` / \`(item) =>\` / \`(e) =>\` if TS cannot infer.
  - Select/Switch: \`(value: string) =>\`, \`(checked: boolean) =>\`
  - DOM: \`(e: React.ChangeEvent<HTMLInputElement>) =>\`, \`(e: React.FormEvent<HTMLFormElement>) =>\`
  - Arrays: type the array or annotate \`(row: Student) =>\`
- Prefer named types / interfaces for form state and list rows; avoid \`any\` and untyped destructuring.
- After editing \`.ts\` / \`.tsx\`, call the \`typecheck\` tool and fix errors (esp. TS7006) before finishing.

## Sandbox / edits
- Mutate files ONLY via Sandbox tools. \`index.html\` and \`package.json\` cannot be deleted.
- Keep changes minimal and coherent with the existing design.
- Before writing UI, readFile the target page and any \`src/components/ui/*\` you will import.
- After edits, briefly confirm what changed (Chinese summary).

## Persistence / Dynamic DB
- Schema, seed, or admin CRUD: loadSkill("dynamic-db") then use the dynamicDb tool (projectId is auto-bound).
- Flow: setupSchema → dynamicDb codegen → readFile src/ddb/generated/index.ts (kindNames) → app code uses getDb() from src/lib/db.ts only.
- Never curl/fetch Dynamic DB HTTP or hand-write a second DB client.
${buildSkillsPromptSection()}`;

function listUiComponents(sandbox: Sandbox): string[] {
  return sandbox
    .list()
    .filter((path) => /^src\/components\/ui\/[^/]+\.tsx?$/.test(path))
    .map((path) => path.replace(/^src\/components\/ui\//, "").replace(/\.tsx?$/, ""))
    .sort();
}

function projectContext(sandbox: Sandbox): string {
  const files = sandbox.list();
  const packageJson = sandbox.exists("package.json") ? sandbox.read("package.json") : "(missing)";
  const ui = listUiComponents(sandbox);
  const uiBlock = ui.length
    ? `Available shadcn UI components (src/components/ui):\n${ui.map((name) => `- ${name}`).join("\n")}`
    : "Available shadcn UI components: (none yet — create under src/components/ui/ if needed)";
  return `Current files (${files.length}):\n${files.map((f) => `- ${f}`).join("\n")}\n\n${uiBlock}\n\npackage.json:\n${packageJson}`;
}

/** Fixed prompt overhead (instructions + project snapshot) — kept for diagnostics. */
export function estimateAgentFixedTokens(sandbox: Sandbox): number {
  return estimateTextTokens(RUNTIME_RULES) + estimateTextTokens(projectContext(sandbox));
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
  if (typeof values.operation === "string") {
    const kind = typeof values.kind === "string" ? ` ${values.kind}` : "";
    return `${values.operation}${kind}`;
  }
  if (typeof values.name === "string") return values.name;
  return undefined;
}

export async function runPlanExecutorAgent(
  prompt: string,
  sandbox: Sandbox,
  options: {
    settings?: AiSettings;
    history?: AgentChatTurn[];
    /** Prior rolling summary from a previous agent turn. */
    conversationSummary?: string;
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
  options.onProgress?.({ type: "compacting" });
  const preparedHistory = await prepareHistoryContext({
    history: options.history,
    previousSummary: options.conversationSummary,
    model,
    contextWindow: settings.contextWindow,
    abortSignal: options.abortSignal,
  });
  const historyBlock = preparedHistory.block;
  const previewErrorBlock = formatPreviewErrors(options.previewErrors);
  const before = new Set(sandbox.list());
  const snapshot = new Map<string, string>();
  for (const path of before) snapshot.set(path, sandbox.read(path));

  options.onProgress?.({ type: "planning" });

  // Track peak provider-reported prompt size for the context meter + compact trigger.
  let peakInputTokens = 0;
  const reportUsage = (usage: LanguageModelUsage | undefined) => {
    const inputTokens = readInputTokens(usage);
    if (inputTokens == null) return;
    peakInputTokens = Math.max(peakInputTokens, inputTokens);
    options.onProgress?.({
      type: "usage",
      inputTokens,
      totalTokens: typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined,
    });
  };

  // Non-streaming planner: MiniMax streaming often truncates nested submitPlan JSON.
  const planResult = await generateText({
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
Inspect the file list, available UI components, and package.json carefully.
Plan only against the Stack above (React 19 + TS + shadcn ui + Tailwind v4 + HashRouter) — never Next.js or other kits.
If preview console errors are provided, prioritize fixing them when the user asks to fix bugs or the errors block the request.`,
    prompt: `User request:\n${prompt}${historyBlock}${previewErrorBlock}\n\nProject context:\n${projectContext(sandbox)}`,
  });
  reportUsage(planResult.usage);

  const planFromTool = planResult.toolResults.find(
    (result) => result.toolName === "submitPlan" && result.type === "tool-result",
  )?.output;
  const planFromCall = planResult.toolCalls.find(
    (call) => call.toolName === "submitPlan",
  )?.input;
  const plan =
    coercePlan(planFromTool) ?? coercePlan(planFromCall) ?? fallbackPlan(prompt);

  options.onProgress?.({ type: "planned", plan });
  options.onProgress?.({ type: "executing" });

  const tools = {
    ...createSandboxTools(sandbox),
    ...createSkillTools(),
    ...createDdbTools(sandbox),
    ...createTypecheckTools(sandbox),
  };
  const threshold = compactThreshold(settings.contextWindow);
  const executor = new ToolLoopAgent({
    model,
    instructions: `${RUNTIME_RULES}

You are the Executor. Implement the given plan using Sandbox tools (and dynamicDb / loadSkill / typecheck when needed).
Workflow:
1. listFiles / readFile / grep to inspect before writing.
   - grep: start with outputMode=files when locating symbols; then content (default context=2) on a few paths.
   - Prefer word=true for identifier/symbol names; fuzzy=true when spelling is uncertain; regex=true for precise patterns.
   - Use glob (e.g. **/*.{ts,tsx}) or paths to narrow. Use before/after context from hits for replaceInFile when possible.
   - Before importing a UI primitive, confirm it is in the available components list (or add it under src/components/ui/).
2. Prefer replaceInFile for surgical edits; writeFile/addFile for new or full rewrites.
3. Use applyOperations for multi-file atomic batches.
4. Match existing import style (@/… with .tsx extensions, cn(), lucide-react, HashRouter). Annotate callback params under strict TS.
5. Persistence: loadSkill dynamic-db → dynamicDb setupSchema → dynamicDb codegen → getDb() in app code.
6. After .ts/.tsx edits: call typecheck. If ok=false, fix diagnostics (especially TS7006 implicit any) and typecheck again before finishing.
7. When done, reply with a short Chinese summary of what you changed.`,
    tools,
    stopWhen: isStepCount(40),
    // Prefer provider inputTokens when available; fall back to message-size estimate.
    // https://ai-sdk.dev/cookbook/guides/agent-context-compaction
    prepareStep: ({ messages }) => {
      const force = peakInputTokens >= threshold;
      const compacted = compactLoopMessages(messages, settings.contextWindow, { force });
      return compacted ? { messages: compacted } : undefined;
    },
    onStepEnd(step) {
      reportUsage(step.usage);
    },
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
    `Plan summary: ${plan.summary}`,
    ...plan.steps.map(
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
      case "finish-step":
        // Per-step usage.inputTokens = real prompt size for that model call.
        reportUsage(part.usage);
        break;
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
    reply: reply.trim() || plan.summary,
    reasoning: reasoning.trim(),
    changed: collectChangedPaths(sandbox, before, snapshot),
    plan,
    conversationSummary: preparedHistory.summary,
    usage: peakInputTokens > 0 ? { inputTokens: peakInputTokens } : undefined,
  };
}

export const AGENT_SUGGESTIONS = [
  "把主标题改得更有冲击力",
  "增加一个深色模式切换",
  "加一个学生表并用 Dynamic DB 做列表页",
  "汉化整个落地页",
];
