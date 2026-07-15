import { APICallError, generateText, isStepCount, tool, ToolLoopAgent, type LanguageModelUsage } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox";
import type { AgentToolActivity } from "../../types";
import { compactLoopMessages, estimateTextTokens, prepareHistoryContext } from "./context";
import { createLanguageModel } from "./provider";
import {
  buildSkillsPromptSection,
  resolveSkills,
  type SkillId,
} from "./skills/registry";
import { compactThreshold, isAiConfigured, loadAiSettings, type AiSettings } from "./settings";
import {
  createAgentCliRuntime,
  createAgentCliTools,
  type PreviewConsoleAccess,
} from "../agent-cli";
import {
  appendToolArgDelta,
  extractJsonStringField,
  extractStreamingFileFields,
  isCliFileBodyRaw,
} from "./stream-file-preview";

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

const BASE_RUNTIME_RULES = `You are a senior coding agent working on a pure-frontend virtual project previewed live in the browser.
Core loop: understand → change → verify. Never report success without verification.

## Stack (fixed — never assume another)
- TypeScript strict + React 19 (react-jsx); \`.ts\` / \`.tsx\` files; ESM only.
- Browser-only preview: NO Node server, NO local node_modules. Every imported package must be declared in package.json (resolved via esm.sh import maps); never assume npm install ran.
- Imports: \`@/\` → \`src/\`; keep \`.ts\` / \`.tsx\` extensions on local/alias imports like neighboring files. Never use filesystem-absolute paths.
- NOT Next.js / Remix / Expo: no \`next/*\`, no RSC / server actions / \`"use client"\`, no \`process.env\` secrets.
- Routing: keep \`BrowserRouter basename={window.__PREVIEW_BASENAME__ ?? ""}\` (or the project's existing HashRouter) in \`main.tsx\` only. A BrowserRouter without that basename escapes the Preview scope and breaks refresh.
- Route tree (react-router-dom v6/v7 — mandatory):
  - Exactly one \`<Routes>\` in the app (normally \`App.tsx\`). Never nest \`<Routes>\` inside another \`<Routes>\` or inside a page.
  - Never nest \`<Route>\` as another's \`element\` (illegal: \`<Route element={<Route ... />} />\`). Pages/layouts are plain components — not \`Route\`.
  - Flat routes by default: \`<Routes><Route path="/" element={<Home />} /><Route path="/about" element={<About />} /></Routes>\`.
  - Layout nesting only via parent \`element={<Layout />}\` + \`<Outlet />\` in the layout, with child \`<Route>\` siblings under that parent (relative paths). Do not wrap children in a second \`<Routes>\`.
  - Before adding routes, read \`main.tsx\` + \`App.tsx\` (and any existing router file) so you extend the existing tree instead of inventing a parallel one.
- Link + Button: \`<Button asChild><Link to="/path">Label</Link></Button>\` — never wrap \`<Button>\` inside \`<Link>\`.
- Three.js / R3F: \`@react-three/fiber@^9\` + \`@react-three/drei@^10\` (+ \`three\`). NEVER fiber@8 / drei@9 — they target React 18 and crash via esm.sh.

## Code quality
- Minimal diff: change only what the request needs — no drive-by refactors, renames, or style rewrites of untouched code.
- High cohesion / low coupling: pages orchestrate, components render, \`src/lib/*\` holds pure logic, data stays behind existing facades (e.g. getDb()). Do not leak DOM/Tailwind into lib or DB details into presentational components.
- Reuse existing patterns, components, and utils before inventing new ones; no parallel abstractions for the same concern.
- Intent-revealing names; no \`any\`, no dead code, no commented-out blocks, no unused imports.

## UI & styling
- shadcn (new-york): reuse ONLY components existing under \`src/components/ui/*\` (listed in project context), import like \`@/components/ui/button.tsx\`; icons from \`lucide-react\`; merge classes with \`cn\` from \`@/lib/utils.ts\`.
- Missing primitive: add it under \`src/components/ui/\` in shadcn/Radix style and add any new \`@radix-ui/*\` dep to package.json. Never pull in other UI kits (MUI, Ant, Chakra, daisyUI…).
- Tailwind CSS v4 via injected \`@tailwindcss/browser\`: use semantic tokens (\`bg-background\`, \`text-foreground\`, \`text-muted-foreground\`, \`border-border\`…); tokens live in \`src/index.css\`; no tailwind.config / PostCSS build steps.

## TypeScript strict (noImplicitAny)
- Annotate callback params when inference fails — never bare \`(v) =>\` / \`(e) =>\`: Select \`(value: string) =>\`, Switch \`(checked: boolean) =>\`, DOM \`(e: React.ChangeEvent<HTMLInputElement>) =>\`, arrays \`(row: Student) =>\`. Prefer named types for form state and list rows.

## Agent CLI capability model
- The host-loaded skills section in the current prompt is the only source of capabilities; conversation history never grants any.
- Commands documented in loaded skills are callable directly via \`cli_execute\`. Use the meta-tools \`cli_search\` / \`cli_describe\` only when a command or its arguments are genuinely uncertain (meta-tools are never valid \`cli_execute.command\` values).
- After a failed execution call \`cli_diagnose\` with the executionId and follow its structured recovery — no blind retries.
- If a required capability is not loaded, say which skill the user must enable; never simulate it or claim success.`;

const PLANNER_INSTRUCTIONS = `${BASE_RUNTIME_RULES}

You are the Planner — think before coding. Call submitPlan exactly once. Do not write code.

Planning discipline:
1. Ground the plan in reality: the file list, UI components, package.json, and host-loaded skills. Plan only operations those capabilities support.
2. \`summary\` restates the goal; \`approach\` records architecture choices (reuse vs new files, layering, coupling risks).
3. 2–8 ordered steps, one cohesive concern each, with target files. Order by dependency: types/lib → data/schema → components → pages/wiring.
4. Keep it minimal: extend existing modules over new parallel folders; no unrelated polish, renames, or speculative abstractions.
5. If preview console errors are listed, they are current runtime failures — plan to fix them first when they block the request or the user asked.
6. When the Sandbox skill is loaded, the final step is always verification: typecheck plus a Preview error check.`;

const EXECUTOR_INSTRUCTIONS = `${BASE_RUNTIME_RULES}

You are the Executor. Implement the plan with clean, surgical changes; all project, data, and verification operations go through host-loaded skill commands via \`cli_execute\`.

Workflow (per step, using commands from the loaded skills — e.g. Sandbox):
1. Read before you write: \`sandbox.readFile\` / \`sandbox.grep\` the exact code you are about to change — never edit from memory of the file list alone.
2. Edit precisely: \`sandbox.replaceInFile\` for local changes, \`sandbox.addFile\` for new files, \`sandbox.writeFile\` only for full rewrites, \`sandbox.applyOperations\` for atomic multi-file changes. Match neighboring style (imports, naming, patterns). New deps go into package.json in the same change.
3. If the plan no longer fits the current state, adapt minimally and note the deviation in the final summary.

Verify (mandatory whenever the Sandbox skill is loaded — do not skip, do not defer):
- After editing any \`.ts\` / \`.tsx\`: run \`sandbox.typecheck\`. Fix every reported error, then re-run until clean.
- After changes that affect rendering or runtime behavior: run \`sandbox.getPreviewErrors\` (wait=true). Fix reported errors and re-check.
- A failed verification is your bug to fix now — re-read the failing code, patch, re-verify. If the same error survives 2 fix attempts, try a different approach instead of repeating the edit.
- Budget your loop: finish all edits of a step, then verify once — do not typecheck after every micro-edit, and never end the turn with a known-broken state.

Finish: reply with a short Chinese summary — what changed, verification results (typecheck / preview), and any plan deviations. Only claim success if verification passed.`;

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

/** Fixed prompt overhead. Per-run skill playbooks intentionally stay outside this estimate. */
export function estimateAgentFixedTokens(sandbox: Sandbox): number {
  return estimateTextTokens(EXECUTOR_INSTRUCTIONS) + estimateTextTokens(projectContext(sandbox));
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

const META_TOOL_TITLES: Record<string, string> = {
  cli_search: "搜索命令",
  cli_describe: "查看命令说明",
  cli_diagnose: "诊断失败",
  cli_execute: "执行命令",
};

function cliExecuteArgs(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const values = input as Record<string, unknown>;
  const bags = [values.arguments, values.args, values.input, values.params];
  for (const bag of bags) {
    if (bag && typeof bag === "object" && !Array.isArray(bag)) {
      return bag as Record<string, unknown>;
    }
    if (typeof bag === "string" && bag.trim()) {
      try {
        const parsed = JSON.parse(bag) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Partial / invalid JSON while streaming — fall through.
      }
    }
  }
  // Flattened form: path/content/… sit on the top level.
  const flat: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "command" || key === "arguments" || key === "args" || key === "input" || key === "params") {
      continue;
    }
    flat[key] = value;
  }
  return flat;
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
  if (typeof values.command === "string") {
    const args = cliExecuteArgs(input);
    if (typeof args.path === "string") {
      if (typeof args.around === "number") {
        const radius = typeof args.radius === "number" ? args.radius : 40;
        return `${args.path}:${args.around}±${radius}`;
      }
      if (typeof args.startLine === "number") {
        const end =
          typeof args.endLine === "number" ? `-${args.endLine}` : "+";
        return `${args.path}:${args.startLine}${end}`;
      }
      return args.path;
    }
    if (typeof args.query === "string") return String(args.query).slice(0, 60);
    if (typeof args.kind === "string") return args.kind;
    if (Array.isArray(args.operations)) return `${args.operations.length} 项操作`;
    return undefined;
  }
  if (Array.isArray(values.operations)) return `${values.operations.length} 项操作`;
  if (typeof values.operation === "string") {
    const kind = typeof values.kind === "string" ? ` ${values.kind}` : "";
    return `${values.operation}${kind}`;
  }
  if (typeof values.name === "string") return values.name;
  if (typeof values.executionId === "string") return values.executionId;
  return undefined;
}

function resolveToolTitle(
  toolName: string,
  input: unknown,
  resolveCommandTitle: (command: string) => string | undefined,
): string {
  if (toolName === "cli_execute") {
    const command =
      input && typeof input === "object" && typeof (input as { command?: unknown }).command === "string"
        ? (input as { command: string }).command.trim()
        : "";
    if (command) {
      return resolveCommandTitle(command) ?? command;
    }
  }
  return META_TOOL_TITLES[toolName] ?? toolName;
}

const FILE_BODY_CLI_COMMANDS = new Set([
  "sandbox.writeFile",
  "sandbox.addFile",
  "sandbox.replaceInFile",
]);

function isFileBodyCliExecute(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" && FILE_BODY_CLI_COMMANDS.has(command);
}

function isFileBodyTool(name: string, input?: unknown): boolean {
  if (name === "cli_execute") return isFileBodyCliExecute(input);
  return false;
}

function fileBodyToolPreview(name: string, input: unknown): { detail?: string; content?: string } {
  if (name === "cli_execute" && isFileBodyCliExecute(input) && input && typeof input === "object") {
    const args = cliExecuteArgs(input);
    const content =
      typeof args.newString === "string"
        ? args.newString
        : typeof args.content === "string"
          ? args.content
          : undefined;
    const path =
      typeof args.path === "string"
        ? args.path
        : typeof args.file === "string"
          ? args.file
          : typeof args.filepath === "string"
            ? args.filepath
            : typeof args.filePath === "string"
              ? args.filePath
              : undefined;
    return {
      detail: path ?? toolDetail(input),
      content,
    };
  }
  return { detail: toolDetail(input) };
}

function formatToolFailure(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const values = output as Record<string, unknown>;
  if (values.ok !== false) return undefined;
  if (typeof values.error === "string") return values.error;
  if (values.error && typeof values.error === "object") {
    const err = values.error as { message?: unknown; code?: unknown };
    if (typeof err.message === "string") {
      return typeof err.code === "string" ? `${err.code}: ${err.message}` : err.message;
    }
  }
  return "工具执行失败";
}

function isCancelledToolOutput(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const values = output as Record<string, unknown>;
  if (values.ok !== false) return false;
  if (values.error && typeof values.error === "object") {
    return (values.error as { code?: unknown }).code === "CANCELLED";
  }
  return false;
}

export async function runPlanExecutorAgent(
  prompt: string,
  sandbox: Sandbox,
  options: {
    settings?: AiSettings;
    history?: AgentChatTurn[];
    /** Skills explicitly selected in the composer for this run. */
    skillIds: readonly SkillId[];
    /** Prior rolling summary from a previous agent turn. */
    conversationSummary?: string;
    previewErrors?: string[];
    /** Live Preview console access for the getPreviewErrors tool. */
    previewConsole?: PreviewConsoleAccess;
    onProgress?: (event: AgentProgress) => void;
    abortSignal?: AbortSignal;
  },
): Promise<AgentResult> {
  const settings = options.settings ?? loadAiSettings();
  if (!isAiConfigured(settings)) {
    throw new Error("请先配置 API Base URL、API Key 和 Model。");
  }

  const resolvedSkills = resolveSkills(options.skillIds);
  const hasSandbox = resolvedSkills.activeIds.includes("sandbox");
  const skillsPrompt = buildSkillsPromptSection(resolvedSkills);
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
  const previewErrorBlock = hasSandbox ? formatPreviewErrors(options.previewErrors) : "";
  const visibleProjectContext = hasSandbox
    ? projectContext(sandbox)
    : "Project context unavailable because the Sandbox skill is not loaded.";
  const before = hasSandbox ? new Set(sandbox.list()) : new Set<string>();
  const snapshot = new Map<string, string>();
  if (hasSandbox) {
    for (const path of before) snapshot.set(path, sandbox.read(path));
  }

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
    instructions: PLANNER_INSTRUCTIONS,
    prompt: `${skillsPrompt}\n\nUser request:\n${prompt}${historyBlock}${previewErrorBlock}\n\nProject context:\n${visibleProjectContext}`,
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
  const agentCli = createAgentCliRuntime({
    plugins: resolvedSkills.plugins,
    context: { sandbox, previewConsole },
    signal: options.abortSignal,
  });
  const tools = createAgentCliTools(agentCli);
  const commandTitle = (command: string) =>
    agentCli.registry.get(command)?.metadata.title;
  const toolTitle = (toolName: string, input?: unknown) =>
    resolveToolTitle(toolName, input, commandTitle);
  const threshold = compactThreshold(settings.contextWindow);
  const executor = new ToolLoopAgent({
    model,
    instructions: EXECUTOR_INSTRUCTIONS,
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
          title: toolTitle(toolCall.toolName, toolCall.input),
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
        error = formatToolFailure(toolOutput.output);
      }
      const cancelled =
        options.abortSignal?.aborted === true ||
        isCancelledToolOutput(toolOutput.type === "tool-result" ? toolOutput.output : undefined);
      const preview = fileBodyToolPreview(toolCall.toolName, toolCall.input);
      options.onProgress?.({
        type: "tool",
        tool: {
          id: toolCall.toolCallId,
          name: toolCall.toolName,
          title: toolTitle(toolCall.toolName, toolCall.input),
          detail: preview.detail ?? toolDetail(toolCall.input),
          status: cancelled ? "aborted" : error ? "error" : "completed",
          durationMs: toolExecutionMs,
          error: cancelled ? undefined : error,
          inputStreaming: false,
          content: preview.content,
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
    prompt: `${skillsPrompt}\n\nUser request:\n${prompt}${historyBlock}${previewErrorBlock}\n\n${planText}\n\nProject context:\n${visibleProjectContext}\n\nExecute the plan now.`,
  });

  let reply = "";
  let reasoning = "";
  /** Accumulate raw tool-call JSON while args stream in (for write preview). */
  const streamingToolArgs = new Map<string, { name: string; raw: string }>();
  let toolInputFlush: ReturnType<typeof setTimeout> | undefined;
  const dirtyToolInputs = new Set<string>();
  const aborted = () => options.abortSignal?.aborted === true;

  const streamingToolTitle = (toolName: string, raw: string) => {
    if (toolName === "cli_execute") {
      const command = extractJsonStringField(raw, "command")?.trim();
      if (command) return commandTitle(command) ?? command;
    }
    return META_TOOL_TITLES[toolName] ?? toolName;
  };

  const streamingPreview = (toolName: string, raw: string) => {
    if (toolName === "cli_execute" && isCliFileBodyRaw(raw)) {
      return extractStreamingFileFields(raw);
    }
    if (isFileBodyTool(toolName)) return extractStreamingFileFields(raw);
    return {
      path:
        extractJsonStringField(raw, "path") ??
        extractJsonStringField(raw, "file") ??
        extractJsonStringField(raw, "query"),
    };
  };

  const flushToolInputPreviews = () => {
    toolInputFlush = undefined;
    if (aborted()) return;
    for (const id of dirtyToolInputs) {
      const entry = streamingToolArgs.get(id);
      if (!entry) continue;
      const preview = streamingPreview(entry.name, entry.raw);
      const tool: AgentToolActivity = {
        id,
        name: entry.name,
        title: streamingToolTitle(entry.name, entry.raw),
        detail: preview.path,
        status: "running",
        inputStreaming: true,
      };
      if (typeof preview.content === "string") tool.content = preview.content;
      options.onProgress?.({ type: "tool", tool });
    }
    dirtyToolInputs.clear();
  };

  const scheduleToolInputFlush = () => {
    if (aborted() || toolInputFlush !== undefined) return;
    // rAF keeps previews smooth without flooding React on every token.
    toolInputFlush = setTimeout(flushToolInputPreviews, 16);
  };

  const finalizeStreamingTools = () => {
    if (toolInputFlush !== undefined) {
      clearTimeout(toolInputFlush);
      toolInputFlush = undefined;
    }
    for (const [id, entry] of streamingToolArgs) {
      const preview = streamingPreview(entry.name, entry.raw);
      const tool: AgentToolActivity = {
        id,
        name: entry.name,
        title: streamingToolTitle(entry.name, entry.raw),
        detail: preview.path,
        status: "aborted",
        inputStreaming: false,
      };
      if (typeof preview.content === "string") tool.content = preview.content;
      options.onProgress?.({ type: "tool", tool });
    }
    streamingToolArgs.clear();
    dirtyToolInputs.clear();
  };

  try {
    for await (const part of result.stream) {
      if (aborted()) break;
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
            entry.raw = appendToolArgDelta(entry.raw, part.delta);
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
            const preview = streamingPreview(ended.name, ended.raw);
            const tool: AgentToolActivity = {
              id: part.id,
              name: ended.name,
              title: streamingToolTitle(ended.name, ended.raw),
              detail: preview.path,
              status: "running",
              inputStreaming: false,
            };
            if (typeof preview.content === "string") tool.content = preview.content;
            options.onProgress?.({ type: "tool", tool });
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
  } finally {
    if (aborted()) finalizeStreamingTools();
    else if (toolInputFlush !== undefined) clearTimeout(toolInputFlush);
  }

  if (aborted()) {
    const reason = options.abortSignal?.reason;
    throw reason instanceof Error
      ? reason
      : new DOMException("Aborted", "AbortError");
  }

  // Ensure stream errors / final state are surfaced.
  await result.text;

  options.onProgress?.({ type: "done" });

  return {
    reply: reply.trim() || plan.summary,
    reasoning: reasoning.trim(),
    changed: hasSandbox ? collectChangedPaths(sandbox, before, snapshot) : [],
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
