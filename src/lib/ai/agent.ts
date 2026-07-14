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
import { createPreviewTools, type PreviewConsoleAccess } from "./previewTools";
import { buildSkillsPromptSection } from "./skills/registry";
import { compactThreshold, isAiConfigured, loadAiSettings, type AiSettings } from "./settings";

const planStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z
    .string()
    .describe(
      "Concrete change: what/where/why; note reuse vs new modules and any boundary (UI vs lib vs data)",
    ),
  files: z.array(z.string()).optional().describe("Primary files this step touches"),
});

const planSchema = z.object({
  summary: z.string().describe("One-sentence plan summary for the user"),
  approach: z
    .string()
    .optional()
    .describe(
      "Architecture sketch: module split, reuse vs create, cohesion/coupling choices (1–3 short sentences)",
    ),
  steps: z.array(planStepSchema).min(1).max(12),
});

export type AgentPlan = z.infer<typeof planSchema>;

/** MiniMax often breaks nested streaming tool JSON — never block the agent on that. */
function fallbackPlan(userPrompt: string): AgentPlan {
  const summary = userPrompt.trim().slice(0, 160) || "实现用户请求";
  return {
    summary,
    approach: "先读现有结构再最小改动；优先复用已有模块，避免无关重构。",
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

  const approach =
    typeof obj.approach === "string" && obj.approach.trim()
      ? obj.approach.trim()
      : typeof obj.architecture === "string" && obj.architecture.trim()
        ? obj.architecture.trim()
        : undefined;

  const coerced = planSchema.safeParse({
    summary: String(obj.summary ?? steps[0]?.title ?? "实现用户请求"),
    approach,
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

const RUNTIME_RULES = `You are a senior coding agent editing a pure-frontend virtual project previewed in the browser.
Bias: plan first, then implement with clean, cohesive, loosely-coupled code. Prefer clarity over cleverness.

## Stack (always true — do not invent another stack)
- Language: TypeScript strict + React 19 (react-jsx). Files are \`.ts\` / \`.tsx\`.
- Bundler/runtime: Vite-style ESM preview. NO Node server, NO local node_modules at runtime.
- Deps: declare in package.json; Preview resolves via esm.sh import maps. Never assume npm install ran.
- Paths: \`@/\` → \`src/\`. Prefer \`@/...\` imports. Never use filesystem-absolute paths.
- Import extensions: match existing style — local/alias imports usually include \`.ts\` / \`.tsx\` (see tsconfig allowImportingTsExtensions). Mirror neighbors; do not drop extensions inconsistently.
- NOT Next.js / Remix / Expo: no \`next/*\`, no App Router, no RSC (\`"use client"\` unnecessary), no server actions, no \`process.env\` for secrets.
- Routing: entry already wraps with HashRouter. Use \`react-router-dom\` routes under hash. NEVER BrowserRouter / createBrowserRouter (Preview path is \`/__preview__/...\`).
- Three.js / R3F (React 19): use \`@react-three/fiber@^9\` + \`@react-three/drei@^10\` (+ \`three\`). NEVER fiber@8 / drei@9 — they target React 18 and crash with \`ReactCurrentBatchConfig\` via esm.sh.

## Architecture & clean code (high cohesion / low coupling)
- One responsibility per module/file. Pages orchestrate; components render; \`src/lib/*\` holds pure logic/helpers; data access stays behind existing facades (e.g. getDb()).
- Prefer small cohesive units over god files. Extract a helper/component when a concern will be reused or the file is doing two jobs.
- Depend inward on stable APIs: UI → hooks/lib → data. Do not leak DOM/Tailwind into lib, or DB details into presentational components.
- Reuse before inventing: extend existing patterns, components, and utils. Do not add parallel abstractions for the same concern.
- Keep public surfaces small: export only what callers need; colocate private helpers next to their use.
- Names reveal intent (verbs for actions, nouns for types/components). Avoid vague names (data, util2, helper, temp).
- DRY only when duplication shares the same reason to change — do not prematurely abstract one-off UI.
- Minimal diff: change only what the request needs. No drive-by refactors, renames, or style rewrites of untouched code.
- Delete dead code you introduce; do not leave commented-out blocks or unused imports/exports.
- Prefer explicit props and typed state over hidden globals or sprawling context unless the project already uses that pattern.

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
- Explore progressively: grep for keywords → when a hit looks right, readFile with around=line (expand radius as needed) → only then full-file read if you must edit broadly.
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
  if (typeof values.path === "string") {
    if (typeof values.around === "number") {
      const radius = typeof values.radius === "number" ? values.radius : 40;
      return `${values.path}:${values.around}±${radius}`;
    }
    if (typeof values.startLine === "number") {
      const end =
        typeof values.endLine === "number" ? `-${values.endLine}` : "+";
      return `${values.path}:${values.startLine}${end}`;
    }
    return values.path;
  }
  if (typeof values.query === "string") return values.query.slice(0, 80);
  if (Array.isArray(values.operations)) return `${values.operations.length} 项操作`;
  if (typeof values.operation === "string") {
    const kind = typeof values.kind === "string" ? ` ${values.kind}` : "";
    return `${values.operation}${kind}`;
  }
  if (typeof values.name === "string") return values.name;
  return undefined;
}

const FILE_BODY_TOOL_NAMES = new Set(["writeFile", "addFile", "replaceInFile"]);

function isFileBodyTool(name: string): boolean {
  return FILE_BODY_TOOL_NAMES.has(name);
}

/** Decode a JSON string value starting at `start` (first char after opening quote). */
function decodeJsonStringValue(raw: string, start: number): string {
  let i = start;
  let out = "";
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') break;
    if (c === "\\") {
      if (i + 1 >= raw.length) break;
      const n = raw[i + 1];
      if (n === "u") {
        if (i + 5 >= raw.length) break;
        const hex = raw.slice(i + 2, i + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
        continue;
      }
      const map: Record<string, string> = {
        n: "\n",
        r: "\r",
        t: "\t",
        '"': '"',
        "\\": "\\",
        "/": "/",
      };
      out += map[n] ?? n;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function extractJsonStringField(raw: string, field: string): string | undefined {
  const key = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!key || key.index == null) return undefined;
  return decodeJsonStringValue(raw, key.index + key[0].length);
}

/** Pull path + body from partial tool-call JSON (write content / replace newString). */
function extractStreamingFileFields(raw: string): { path?: string; content?: string } {
  const path = extractJsonStringField(raw, "path");
  // Prefer the payload being authored: newString (edit) > content (write) > oldString (still streaming).
  const content =
    extractJsonStringField(raw, "newString") ??
    extractJsonStringField(raw, "content") ??
    extractJsonStringField(raw, "oldString");
  return { path, content };
}

function fileBodyToolPreview(name: string, input: unknown): { detail?: string; content?: string } {
  if (!isFileBodyTool(name) || !input || typeof input !== "object") {
    return { detail: toolDetail(input) };
  }
  const values = input as Record<string, unknown>;
  const content =
    typeof values.newString === "string"
      ? values.newString
      : typeof values.content === "string"
        ? values.content
        : undefined;
  return {
    detail: typeof values.path === "string" ? values.path : toolDetail(input),
    content,
  };
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
    /** Live Preview console access for the getPreviewErrors tool. */
    previewConsole?: PreviewConsoleAccess;
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

You are the Planner — think before coding. Call submitPlan exactly once. Do not write code.

Planning discipline:
1. Read the file list, UI components, and package.json. Infer existing module boundaries and patterns.
2. Restate the goal in \`summary\`. Put architecture choices in \`approach\` (reuse vs new files, layering, coupling risks to avoid).
3. Break work into 2–8 ordered steps that map to Sandbox tool batches. Each step: one cohesive concern, clear files, and why.
4. Order by dependency: types/lib → data/schema → components → pages/wiring → verify (typecheck / preview).
5. Prefer extending existing modules over new parallel folders. Flag when a god file should be split — only if needed for this request.
6. Keep the plan minimal: omit unrelated polish, renames, and speculative abstractions.
7. Plan only against the Stack above (React 19 + TS + shadcn ui + Tailwind v4 + HashRouter) — never Next.js or other kits.
8. If preview console errors are provided and the user wants fixes (or errors block the request), prioritize them. The executor can re-check with getPreviewErrors after edits.`,
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

  const previewConsole: PreviewConsoleAccess = options.previewConsole ?? {
    getErrors: () => options.previewErrors ?? [],
  };
  const tools = {
    ...createSandboxTools(sandbox),
    ...createSkillTools(),
    ...createDdbTools(sandbox),
    ...createTypecheckTools(sandbox),
    ...createPreviewTools(previewConsole),
  };
  const threshold = compactThreshold(settings.contextWindow);
  const executor = new ToolLoopAgent({
    model,
    instructions: `${RUNTIME_RULES}

You are the Executor. Follow the plan; implement with clean, cohesive code. Use Sandbox tools (and dynamicDb / loadSkill / typecheck / getPreviewErrors when needed).

Implementation style:
- Honor \`approach\` and step boundaries: do not dump unrelated logic into one file.
- Pages thin; extract reusable UI into components; keep pure helpers in src/lib.
- Surgical diffs: replaceInFile for local edits; writeFile/addFile only for new files or intentional full rewrites.
- Match neighboring style (imports, naming, component patterns). No drive-by refactors outside the plan.
- If the plan is wrong given what you read, adapt minimally and note the deviation in the final summary — do not balloon scope.

Workflow:
1. Progressive search before writing (do not dump whole files first):
   a. Orient: listFiles or grep outputMode=files with a keyword / symbol / glob.
   b. Pin: grep content (context=2) on promising paths — prefer word=true for identifiers; fuzzy=true if spelling unsure; regex=true for precise patterns.
   c. Expand: for each relevant hit, readFile(path, around=hit.line, radius=30–60). If still incomplete, widen radius or startLine/endLine; follow imports/symbols with another grep.
   d. Commit context: only full-file readFile when the file is small or you need the whole module to rewrite.
   e. Windowed reads return \`LINE|…\` prefixes — strip them before replaceInFile oldString/newString.
   f. Before importing a UI primitive, confirm it is in the available components list (or add it under src/components/ui/).
2. Prefer replaceInFile for surgical edits; writeFile/addFile for new or full rewrites.
3. Use applyOperations for multi-file atomic batches that must succeed together.
4. Match existing import style (@/… with .tsx extensions, cn(), lucide-react, HashRouter). Annotate callback params under strict TS.
5. Persistence: loadSkill dynamic-db → dynamicDb setupSchema → dynamicDb codegen → getDb() in app code.
6. After .ts/.tsx edits: call typecheck. If ok=false, fix diagnostics (especially TS7006 implicit any) and typecheck again before finishing.
7. After UI/runtime-affecting edits (or when preview console errors were in the prompt): call getPreviewErrors(wait=true). If ok=false, fix those lines and re-check before finishing.
8. When done, reply with a short Chinese summary: what changed, module split if any, and any plan deviations.`,
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
      const preview = fileBodyToolPreview(toolCall.toolName, toolCall.input);
      options.onProgress?.({
        type: "tool",
        tool: {
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          detail: preview.detail,
          status: "running",
          inputStreaming: false,
          content: preview.content,
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
          inputStreaming: false,
        },
      });
    },
  });

  const planText = [
    `Plan summary: ${plan.summary}`,
    plan.approach ? `Approach: ${plan.approach}` : null,
    ...plan.steps.map(
      (step, index) =>
        `${index + 1}. [${step.id}] ${step.title}\n   ${step.detail}${
          step.files?.length ? `\n   files: ${step.files.join(", ")}` : ""
        }`,
    ),
  ]
    .filter(Boolean)
    .join("\n");

  // Re-read project after planning so executor sees any concurrent UI edits.
  const result = await executor.stream({
    abortSignal: options.abortSignal,
    prompt: `User request:\n${prompt}${historyBlock}${previewErrorBlock}\n\n${planText}\n\nProject context:\n${projectContext(sandbox)}\n\nExecute the plan now.`,
  });

  let reply = "";
  let reasoning = "";
  /** Accumulate raw tool-call JSON while args stream in (for write preview). */
  const streamingToolArgs = new Map<string, { name: string; raw: string }>();
  let toolInputFlush: ReturnType<typeof setTimeout> | undefined;
  const dirtyToolInputs = new Set<string>();

  const flushToolInputPreviews = () => {
    toolInputFlush = undefined;
    for (const id of dirtyToolInputs) {
      const entry = streamingToolArgs.get(id);
      if (!entry) continue;
      const preview = isFileBodyTool(entry.name)
        ? extractStreamingFileFields(entry.raw)
        : { path: extractJsonStringField(entry.raw, "path") ?? extractJsonStringField(entry.raw, "query") };
      options.onProgress?.({
        type: "tool",
        tool: {
          id,
          name: entry.name,
          detail: preview.path,
          status: "running",
          inputStreaming: true,
          content: "content" in preview ? preview.content : undefined,
        },
      });
    }
    dirtyToolInputs.clear();
  };

  const scheduleToolInputFlush = () => {
    if (toolInputFlush !== undefined) return;
    toolInputFlush = setTimeout(flushToolInputPreviews, 40);
  };

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
      case "tool-input-start":
        streamingToolArgs.set(part.id, { name: part.toolName, raw: "" });
        dirtyToolInputs.add(part.id);
        // Immediate first paint so the fold appears before the first delta flush.
        flushToolInputPreviews();
        break;
      case "tool-input-delta": {
        const entry = streamingToolArgs.get(part.id);
        if (entry) {
          entry.raw += part.delta;
          dirtyToolInputs.add(part.id);
          scheduleToolInputFlush();
        }
        break;
      }
      case "tool-input-end": {
        if (toolInputFlush !== undefined) {
          clearTimeout(toolInputFlush);
          toolInputFlush = undefined;
        }
        dirtyToolInputs.add(part.id);
        flushToolInputPreviews();
        const ended = streamingToolArgs.get(part.id);
        if (ended) {
          const preview = isFileBodyTool(ended.name)
            ? extractStreamingFileFields(ended.raw)
            : { path: extractJsonStringField(ended.raw, "path") };
          options.onProgress?.({
            type: "tool",
            tool: {
              id: part.id,
              name: ended.name,
              detail: preview.path,
              status: "running",
              inputStreaming: false,
              content: "content" in preview ? preview.content : undefined,
            },
          });
          streamingToolArgs.delete(part.id);
        }
        break;
      }
      case "text-delta":
        reply += part.text;
        options.onProgress?.({ type: "text-delta", delta: part.text });
        break;
      case "error":
        throw part.error;
    }
  }

  if (toolInputFlush !== undefined) clearTimeout(toolInputFlush);

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
