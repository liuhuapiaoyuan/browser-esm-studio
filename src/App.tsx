import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AgentResponse } from "./components/ai-elements/agent-response";
import { SkillPicker, snapshotSkillIds, updateRequestedSkillIds } from "./components/skill-picker";
import { DEFAULT_FILES } from "./defaultProject";
import { AGENT_SUGGESTIONS, formatAgentError, runPlanExecutorAgent, type AgentProgress } from "./lib/ai/agent";
import { requestAgentNotifyPermission, runAgentHooks } from "./lib/ai/hooks";
import { COMPACT_RATIO, compactThreshold, isAiConfigured, loadAiSettings, saveAiSettings, type AiSettings } from "./lib/ai/settings";
import { defaultSkillIds, listSkills, resolveSkills, type SkillId } from "./lib/ai/skills/registry";
import { buildFileTree, fileLanguage, normalizePath, type TreeNode } from "./lib/path";
import { previewUrl, syncPreviewProject } from "./lib/preview";
import { createPreviewConsole } from "./lib/preview-console";
import {
  buildReferencePath,
  importReferenceHtml,
  isHtmlReferenceName,
  listReferenceHtmlPaths,
  REFERENCE_SIZE_WARN_BYTES,
} from "./lib/reference-html";
import { createSandbox, SandboxError, type Sandbox } from "./lib/sandbox";
import {
  ensureDdbProject,
  ensureDdbStack,
  getDynamicDbUserId,
  resolveDynamicDbUserRoles,
} from "./database";
import { formatTypecheckDiagnostics, typecheckProject } from "./lib/typecheck";
import { downloadProjectZip } from "./lib/zip";
import type {
  ChatMessage,
  ChatTimelinePart,
  ConsoleLog,
  FileMap,
  LogLevel,
  RuntimeStatus,
  Viewport,
  WorkspaceMode,
} from "./types";

const STORAGE_KEY = "browser-esm-studio-project-v2";
const SESSION_ID = "workspace";
const AGENT_SKILLS = listSkills();
const SKILL_TITLE_BY_ID = new Map(AGENT_SKILLS.map((skill) => [skill.id, skill.title]));

const ICONS = {
  sparkle: ["M12 3l1.45 4.05L17.5 8.5l-4.05 1.45L12 14l-1.45-4.05L6.5 8.5l4.05-1.45L12 3Z", "M18 14l.72 2.02L21 17l-2.28.98L18 20l-.72-2.02L15 17l2.28-.98L18 14Z"],
  chevron: ["m9 18 6-6-6-6"],
  folder: ["M3 6.8A1.8 1.8 0 0 1 4.8 5h4l2 2h8.4A1.8 1.8 0 0 1 21 8.8v8.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.2V6.8Z"],
  file: ["M6 2.8h8l4 4v14.4H6V2.8Z", "M14 2.8v4h4"],
  code: ["m9 8-4 4 4 4", "m15 8 4 4-4 4"],
  eye: ["M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z", "M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"],
  refresh: ["M20 7v5h-5", "M19 12a7 7 0 1 0-1.4 4.2"],
  desktop: ["M3 4.5h18v12H3z", "M8 20h8", "M12 16.5V20"],
  tablet: ["M6 2.5h12v19H6z", "M11 18.5h2"],
  mobile: ["M8 2.5h8v19H8z", "M11 18.5h2"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M4 20h16"],
  send: ["m3 4 18 8-18 8 3.5-8L3 4Z", "M6.5 12H21"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: ["M4 7h16", "M9 7V4h6v3", "m7 7 1 13h10l1-13", "M10 11v5", "M14 11v5"],
  terminal: ["m5 7 4 4-4 4", "M11 15h7"],
  close: ["m6 6 12 12", "M18 6 6 18"],
  external: ["M14 4h6v6", "m20 4-9 9", "M18 13v7H4V6h7"],
  check: ["M5 12l4 4L19 6"],
  settings: ["M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z", "M19.4 13.1a1.5 1.5 0 0 0 .1-1.2l1.1-.9-1.2-2.1-1.4.3a5.8 5.8 0 0 0-1-.6l-.2-1.4h-2.4l-.2 1.4a5.8 5.8 0 0 0-1 .6l-1.4-.3-1.2 2.1 1.1.9a1.5 1.5 0 0 0 .1 1.2l-1.1.9 1.2 2.1 1.4-.3a5.8 5.8 0 0 0 1 .6l.2 1.4h2.4l.2-1.4a5.8 5.8 0 0 0 1-.6l1.4.3 1.2-2.1-1.1-.9Z"],
  paperclip: ["M21.4 11.6 12.1 20.9a5.5 5.5 0 0 1-7.8-7.8l9.9-9.9a3.5 3.5 0 0 1 5 5l-9.9 9.9a1.5 1.5 0 0 1-2.1-2.1l8.5-8.5"],
} as const;

type IconName = keyof typeof ICONS;

function Icon({ name, size = 18, strokeWidth = 1.8 }: { name: IconName; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {(ICONS[name] || ICONS.file).map((path, index) => <path d={path} key={index} />)}
    </svg>
  );
}

function loadFiles(): FileMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as FileMap) : DEFAULT_FILES;
  } catch {
    return DEFAULT_FILES;
  }
}

function TreeNodeView({
  node,
  activeFile,
  onSelect,
  depth = 0,
}: {
  node: TreeNode;
  activeFile: string;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (node.type === "folder") {
    return (
      <div>
        <button className="tree-row folder-row" style={{ paddingLeft: 9 + depth * 14 }} onClick={() => setExpanded((value) => !value)}>
          <span className={`tree-chevron ${expanded ? "expanded" : ""}`}><Icon name="chevron" size={12} /></span>
          <Icon name="folder" size={15} />
          <span>{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeNodeView node={child} activeFile={activeFile} onSelect={onSelect} depth={depth + 1} key={child.path} />
        ))}
      </div>
    );
  }

  return (
    <button className={`tree-row file-row ${activeFile === node.path ? "active" : ""}`} style={{ paddingLeft: 30 + depth * 14 }} onClick={() => onSelect(node.path)}>
      <span className={`file-glyph ext-${node.name.split(".").pop()}`}>{node.name.split(".").pop()?.slice(0, 2).toUpperCase()}</span>
      <span>{node.name}</span>
    </button>
  );
}

function FileExplorer({
  files,
  activeFile,
  onSelect,
  onAdd,
  onDelete,
}: {
  files: FileMap;
  activeFile: string;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onDelete: () => void;
}) {
  const tree = useMemo(() => buildFileTree(Object.keys(files)), [files]);
  return (
    <aside className="file-explorer">
      <div className="file-heading">
        <span>文件</span>
        <div>
          <button className="icon-button subtle" onClick={onAdd} title="新建文件"><Icon name="plus" size={14} /></button>
          <button className="icon-button subtle" onClick={onDelete} title="删除当前文件" disabled={!activeFile}><Icon name="trash" size={14} /></button>
        </div>
      </div>
      <div className="tree">{tree.map((node) => <TreeNodeView node={node} activeFile={activeFile} onSelect={onSelect} key={node.path} />)}</div>
      <div className="file-summary"><i />{Object.keys(files).length} 个虚拟文件</div>
    </aside>
  );
}

function CodeEditor({ path, value, onChange }: { path: string; value: string; onChange: (value: string) => void }) {
  const lineCount = Math.max(1, value.split("\n").length);
  const gutter = Array.from({ length: lineCount }, (_, index) => index + 1).join("\n");
  const gutterRef = useRef<HTMLPreElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      event.currentTarget.selectionStart = event.currentTarget.selectionEnd = start + 2;
    });
  }

  return (
    <section className="editor-pane">
      <header className="editor-tabbar">
        <div className="editor-tab"><span className={`file-dot ext-${path.split(".").pop()}`} />{path}<span className="tab-close">×</span></div>
        <span className="language-label">{fileLanguage(path)}</span>
      </header>
      <div className="editor-body">
        <pre className="line-numbers" ref={gutterRef}>{gutter}</pre>
        <textarea
          aria-label={`编辑 ${path}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={(event) => { if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
          spellCheck={false}
        />
      </div>
    </section>
  );
}

function statusLabel(progress: AgentProgress | null, configured: boolean): string {
  if (!configured) return "未配置 API";
  if (!progress) return "Plan → Executor · Stream";
  switch (progress.type) {
    case "compacting":
      return "整理对话上下文…";
    case "planning":
      return "Planner 规划中…";
    case "planned":
      return `计划就绪 · ${progress.plan.steps.length} 步`;
    case "executing":
      return "Executor 执行中…";
    case "usage":
      return `Context ${formatTokenCount(progress.inputTokens)} tokens`;
    case "reasoning-start":
    case "reasoning-delta":
      return "Agent 思考中…";
    case "reasoning-end":
      return "思考完成，准备下一步…";
    case "tool":
      return `工具 ${progress.tool.title || progress.tool.name}${progress.tool.detail ? ` · ${progress.tool.detail}` : ""}`;
    case "text-delta":
      return "流式输出中…";
    case "done":
      return "完成";
  }
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** Mark in-flight reasoning/tools as stopped so the UI does not stick on “流式写入中”. */
function abortInFlightParts(parts: ChatTimelinePart[]): ChatTimelinePart[] {
  return parts.map((part) => {
    if (part.type === "reasoning" && part.streaming) {
      return { ...part, streaming: false };
    }
    if (part.type === "tool" && (part.tool.status === "running" || part.tool.inputStreaming)) {
      return {
        type: "tool",
        tool: { ...part.tool, status: "aborted", inputStreaming: false },
      };
    }
    return part;
  });
}

function ContextRing({ used, total }: { used: number; total: number }) {
  const safeTotal = Math.max(total, 1);
  const pct = Math.min(1, Math.max(0, used / safeTotal));
  const compactAt = compactThreshold(safeTotal);
  const size = 28;
  const stroke = 2.75;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct);
  const level = used >= safeTotal * 0.9 ? "danger" : used >= compactAt ? "warn" : "ok";
  const title = `Context ${Math.round(pct * 100)}% · ${formatTokenCount(used)} / ${formatTokenCount(safeTotal)} prompt tokens (provider) · compact @ ${Math.round(COMPACT_RATIO * 100)}%`;

  return (
    <div className={`context-ring context-ring-${level}`} title={title} aria-label={title} role="meter" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="context-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle
          className="context-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{Math.round(pct * 100)}</span>
    </div>
  );
}

function formatElementPickPrompt(
  pick: {
    tag: string;
    id?: string;
    className?: string;
    text?: string;
    selector?: string;
    component?: string;
    html?: string;
  },
  instruction: string,
): string {
  const lines = [
    "请修改预览中用户选中的 UI 元素（指哪改哪）。",
    "",
    "选中元素：",
    `- 标签: ${pick.tag}`,
  ];
  if (pick.component) lines.push(`- React 组件: ${pick.component}`);
  if (pick.selector) lines.push(`- 选择器: ${pick.selector}`);
  if (pick.id) lines.push(`- id: ${pick.id}`);
  if (pick.className) lines.push(`- class: ${pick.className}`);
  if (pick.text) lines.push(`- 文本: ${pick.text}`);
  if (pick.html) lines.push("", "HTML:", "```html", pick.html, "```");
  lines.push("", "修改要求：", instruction.trim());
  return lines.join("\n");
}

function ChatPanel({
  sandbox,
  getPreviewErrors,
  waitForPreviewErrors,
  getFiles,
  submitRef,
  onOpenPreview,
}: {
  sandbox: Sandbox;
  getPreviewErrors: () => string[];
  waitForPreviewErrors: (settleMs?: number) => Promise<string[]>;
  getFiles: () => FileMap;
  submitRef?: { current: ((text: string) => void) | null };
  onOpenPreview?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "你好，我是你的 AI 构建搭档。告诉我想做什么，我会先规划，再为你实时修改项目并验证结果。",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [draft, setDraft] = useState<AiSettings>(() => loadAiSettings());
  const [requestedSkillIds, setRequestedSkillIds] = useState<SkillId[]>(() => defaultSkillIds());
  const resolvedSkills = useMemo(
    () => resolveSkills(requestedSkillIds),
    [requestedSkillIds],
  );
  const [filesTick, setFilesTick] = useState(0);
  useEffect(() => sandbox.subscribe(() => setFilesTick((value) => value + 1)), [sandbox]);
  const referencePaths = useMemo(
    () => listReferenceHtmlPaths(sandbox),
    [sandbox, filesTick],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const stickToBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const workingRef = useRef(false);
  /** Rolling summary of older chat turns — UI keeps full messages, model gets this. */
  const [conversationSummary, setConversationSummary] = useState<string | undefined>();
  /** Latest provider-reported prompt tokens (from AI SDK usage.inputTokens). */
  const [contextUsed, setContextUsed] = useState(0);
  const configured = isAiConfigured(settings);

  async function importReferenceFiles(fileList: FileList | null) {
    if (!fileList?.length || workingRef.current) return;
    const imported: string[] = [];

    for (const file of Array.from(fileList)) {
      if (!isHtmlReferenceName(file.name)) {
        window.alert(`跳过 ${file.name}：仅支持 .html / .htm`);
        continue;
      }
      if (file.size > REFERENCE_SIZE_WARN_BYTES) {
        const kb = Math.round(file.size / 1024);
        if (
          !window.confirm(
            `${file.name} 约 ${kb}KB，写入后可能接近浏览器本地存储上限。仍要导入？`,
          )
        ) {
          continue;
        }
      }

      const content = await file.text();
      const path = buildReferencePath(file.name);
      const overwrite = sandbox.exists(path)
        ? window.confirm(`${path} 已存在，是否覆盖？`)
        : true;
      if (sandbox.exists(path) && !overwrite) continue;

      const result = importReferenceHtml(sandbox, file.name, content, { overwrite: true });
      if (!result.ok) {
        window.alert(result.error);
        continue;
      }
      imported.push(result.path);
    }

    if (referenceInputRef.current) referenceInputRef.current.value = "";
    if (!imported.length) return;

    setRequestedSkillIds((current) =>
      updateRequestedSkillIds(AGENT_SKILLS, current, "interactive-quest", true),
    );
    setMessages((current) => [
      ...current,
      {
        role: "assistant",
        text: `已导入参考 HTML：\n${imported.map((path) => `- \`${path}\``).join("\n")}\n\n已启用「${SKILL_TITLE_BY_ID.get("interactive-quest") ?? "参考仿作"}」。发送需求即可按参考页面仿作同类互动（请勿让我全文朗读该文件）。`,
      },
    ]);
    if (!prompt.trim() && imported.length === 1) {
      setPrompt(`请参考 ${imported[0]}，仿作一版同类闯关互动页面。`);
    }
  }

  function onMessagesScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
  }

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, working, progress]);

  function persistSettings() {
    const next = {
      baseURL: draft.baseURL.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      contextWindow: draft.contextWindow,
    };
    saveAiSettings(next);
    setSettings(next);
    setDraft(next);
    setSettingsOpen(false);
  }

  function updateStreamingMessage(patch: Partial<ChatMessage> | ((current: ChatMessage) => ChatMessage)) {
    setMessages((current) => {
      const next = [...current];
      let index = -1;
      for (let i = next.length - 1; i >= 0; i -= 1) {
        if (next[i].role === "assistant" && next[i].streaming) {
          index = i;
          break;
        }
      }
      if (index < 0) return current;
      const message = next[index];
      next[index] = typeof patch === "function" ? patch(message) : { ...message, ...patch };
      return next;
    });
  }

  function stop() {
    abortRef.current?.abort();
    // Instant UI: don't wait for the agent stream to unwind.
    updateStreamingMessage((message) => ({
      ...message,
      parts: message.parts ? abortInFlightParts(message.parts) : message.parts,
    }));
  }

  async function submit(
    event: { preventDefault(): void } | null,
    suggestion?: string,
    skillIdsOverride?: readonly SkillId[],
  ) {
    event?.preventDefault();
    const text = (suggestion || prompt).trim();
    if (!text || workingRef.current) return;
    const skillIdsForTurn = snapshotSkillIds(skillIdsOverride ?? resolvedSkills.activeIds);

    if (!isAiConfigured(settings)) {
      setSettingsOpen(true);
      setMessages((current) => [
        ...current,
        { role: "user", text, skillIds: skillIdsForTurn },
        { role: "assistant", text: "请先配置 API Base URL、API Key 和 Model，再发送请求。" },
      ]);
      setPrompt("");
      return;
    }

    const history = messages
      .filter((message) => message.text.trim().length > 0 && !message.streaming)
      .map((message) => ({ role: message.role, text: message.text }));

    setPrompt("");
    setMessages((current) => [
      ...current,
      { role: "user", text, skillIds: skillIdsForTurn },
      { role: "assistant", text: "", streaming: true },
    ]);
    workingRef.current = true;
    setWorking(true);
    setProgress({ type: "compacting" });

    const controller = new AbortController();
    abortRef.current = controller;
    const parts: ChatTimelinePart[] = [];
    let reasoningSeq = 0;
    let completed: Awaited<ReturnType<typeof runPlanExecutorAgent>> | null = null;

    const cloneParts = (): ChatTimelinePart[] =>
      parts.map((part) =>
        part.type === "tool"
          ? { type: "tool" as const, tool: { ...part.tool } }
          : { type: "reasoning" as const, id: part.id, text: part.text, streaming: part.streaming },
      );

    const publishParts = () => {
      updateStreamingMessage({ parts: cloneParts() });
    };

    const settleAbortedParts = () => {
      const next = abortInFlightParts(parts);
      parts.length = 0;
      parts.push(...next);
    };

    try {
      completed = await runPlanExecutorAgent(text, sandbox, {
        settings,
        history,
        skillIds: skillIdsForTurn,
        conversationSummary,
        previewErrors: getPreviewErrors(),
        previewConsole: {
          getErrors: getPreviewErrors,
          waitForErrors: waitForPreviewErrors,
        },
        abortSignal: controller.signal,
        onProgress: (event) => {
          // Stop must freeze the timeline; late stream ticks must not revive tools.
          if (controller.signal.aborted) return;
          setProgress(event);
          if (event.type === "usage") {
            setContextUsed(event.inputTokens);
          }
          if (event.type === "planned") {
            updateStreamingMessage({ plan: event.plan });
          }
          if (event.type === "reasoning-start") {
            reasoningSeq += 1;
            parts.push({ type: "reasoning", id: `reasoning-${reasoningSeq}`, text: "", streaming: true });
            publishParts();
          }
          if (event.type === "reasoning-delta") {
            const last = parts[parts.length - 1];
            if (last?.type === "reasoning" && last.streaming) {
              last.text += event.delta;
            } else {
              reasoningSeq += 1;
              parts.push({ type: "reasoning", id: `reasoning-${reasoningSeq}`, text: event.delta, streaming: true });
            }
            publishParts();
          }
          if (event.type === "reasoning-end") {
            const last = parts[parts.length - 1];
            if (last?.type === "reasoning") last.streaming = false;
            publishParts();
          }
          if (event.type === "tool") {
            const index = parts.findIndex((part) => part.type === "tool" && part.tool.id === event.tool.id);
            if (index >= 0) {
              const prev = parts[index];
              if (prev.type === "tool") {
                parts[index] = {
                  type: "tool",
                  tool: {
                    ...prev.tool,
                    ...event.tool,
                    // Sparse streaming updates omit content/detail — keep the latest body.
                    title: event.tool.title ?? prev.tool.title,
                    detail: event.tool.detail ?? prev.tool.detail,
                    content: event.tool.content !== undefined ? event.tool.content : prev.tool.content,
                  },
                };
              }
            } else {
              parts.push({ type: "tool", tool: event.tool });
            }
            publishParts();
          }
          if (event.type === "text-delta") {
            updateStreamingMessage((message) => ({
              ...message,
              text: `${message.text}${event.delta}`,
            }));
          }
        },
      });
      if (completed.conversationSummary !== undefined) {
        setConversationSummary(completed.conversationSummary);
      }
      if (completed.usage?.inputTokens) {
        setContextUsed(completed.usage.inputTokens);
      }
      if (controller.signal.aborted) {
        settleAbortedParts();
        updateStreamingMessage({
          text: (completed.reply || "").trim() || "已停止生成。",
          changed: completed.changed,
          plan: completed.plan,
          parts: parts.length > 0 ? cloneParts() : undefined,
          streaming: false,
        });
      } else {
        for (const part of parts) {
          if (part.type === "reasoning") part.streaming = false;
        }
        updateStreamingMessage({
          text: completed.reply,
          changed: completed.changed,
          plan: completed.plan,
          parts: parts.length > 0 ? cloneParts() : undefined,
          streaming: false,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        settleAbortedParts();
      } else {
        for (const part of parts) {
          if (part.type === "reasoning") part.streaming = false;
          if (part.type === "tool" && (part.tool.status === "running" || part.tool.inputStreaming)) {
            part.tool = {
              ...part.tool,
              status: "error",
              inputStreaming: false,
              error: part.tool.error ?? "执行中断",
            };
          }
        }
      }
      const snapshot = parts.length > 0 ? cloneParts() : undefined;
      if (controller.signal.aborted) {
        updateStreamingMessage((message) => ({
          ...message,
          text: message.text.trim() || "已停止生成。",
          parts: snapshot,
          streaming: false,
        }));
      } else {
        updateStreamingMessage((message) => ({
          ...message,
          text: `Agent 失败：${formatAgentError(error)}`,
          parts: snapshot,
          streaming: false,
        }));
      }
    } finally {
      abortRef.current = null;
      workingRef.current = false;
      setWorking(false);
      setProgress(null);
    }

    if (completed && !controller.signal.aborted) {
      await runAgentHooks(
        {
          name: "agent:complete",
          prompt: text,
          result: completed,
          aborted: false,
          getPreviewErrors,
          waitForPreviewErrors,
          getFiles,
          typecheck: () => typecheckProject(getFiles()),
        },
        {
          followUp: (followUpPrompt) => {
            void submit(null, followUpPrompt, skillIdsForTurn);
          },
        },
      );
    }
  }

  useEffect(() => {
    if (!submitRef) return;
    submitRef.current = (text: string) => {
      void submit(null, text);
    };
    return () => {
      submitRef.current = null;
    };
  });

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <div className="brand-lockup">
          <span className="brand-icon"><img src="/logo.png" alt="" /></span>
          <span className="brand-copy">
            <strong>ESM Studio</strong>
            <small>AI 应用创作工作台</small>
          </span>
        </div>
        <div className="chat-header-actions">
          {onOpenPreview ? (
            <button
              type="button"
              className="project-menu mobile-preview-trigger"
              title="打开预览"
              onClick={onOpenPreview}
            >
              <Icon name="eye" size={16} />
              <span>预览</span>
            </button>
          ) : null}
          <button
            type="button"
            className="project-menu"
            title="API 设置"
            onClick={() => {
              setDraft(settings);
              setSettingsOpen((value) => !value);
            }}
          >
            <Icon name="settings" size={16} />
            <span>设置</span>
          </button>
        </div>
      </div>
      {settingsOpen && (
        <div className="ai-settings">
          <label>
            Base URL
            <input
              value={draft.baseURL}
              onChange={(event) => setDraft((current) => ({ ...current, baseURL: event.target.value }))}
              placeholder="/openai-proxy/v1 或 https://api.example.com/v1"
              spellCheck={false}
            />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={draft.apiKey}
              onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
              placeholder="sk-..."
              spellCheck={false}
            />
          </label>
          <label>
            Model
            <input
              value={draft.model}
              onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
              placeholder="gpt-4o"
              spellCheck={false}
            />
          </label>
          <label>
            Context Window (tokens)
            <input
              type="number"
              min={8000}
              step={1000}
              value={draft.contextWindow}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  contextWindow: Number(event.target.value) || current.contextWindow,
                }))
              }
              placeholder="256000"
              spellCheck={false}
            />
          </label>
          <div className="ai-settings-actions">
            <span>Compact 阈值 = 上下文 × 60%（默认 256K → 153.6K）</span>
            <button type="button" onClick={persistSettings}>保存</button>
          </div>
        </div>
      )}
      <div className="chat-context">
        <div className="context-state">
          <span className={`pulse-dot ${configured ? "" : "warn"}`} />
          {configured ? "Agent 已就绪" : "需要配置 API"}
        </div>
        <span className="model-pill">{settings.model || "未选模型"}</span>
      </div>
      <div className="messages" ref={scrollRef} onScroll={onMessagesScroll}>
        <div className="project-intro">
          <div className="intro-orb intro-orb-one" />
          <div className="intro-orb intro-orb-two" />
          <div className="project-intro-copy">
            <span className="intro-kicker"><Icon name="sparkle" size={12} /> AI 全栈创作</span>
            <h2>让灵感，即刻成为应用</h2>
            <p>从一句描述开始，AI 为你规划、编码并实时呈现。</p>
            <div className="intro-features">
              <span>实时预览</span>
              <span>智能改码</span>
              <span>一键导出</span>
            </div>
          </div>
          <img className="intro-character" src="/index-bg.webp" alt="AI 创作助手" />
        </div>
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.role === "assistant" && (
              <span className="assistant-avatar"><img src="/logo.png" alt="" /></span>
            )}
            <div className="message-content">
              {message.role === "assistant" ? (
                <AgentResponse message={message} status={statusLabel(progress, configured)} />
              ) : (
                <>
                  {message.skillIds ? (
                    <div className="message-skills" aria-label="本轮加载技能">
                      {message.skillIds.length ? (
                        message.skillIds.map((id) => (
                          <span key={id}>{SKILL_TITLE_BY_ID.get(id) ?? id}</span>
                        ))
                      ) : (
                        <span className="is-empty">无技能</span>
                      )}
                    </div>
                  ) : null}
                  <p>{message.text}</p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="composer-wrap">
        <div className="suggestions">
          {AGENT_SUGGESTIONS.map((item) => (
            <button onClick={() => submit(null, item)} key={item} type="button" disabled={working}>
              {item}
            </button>
          ))}
        </div>
        <form className="composer" onSubmit={(event) => submit(event)}>
          <div className="composer-toolbar">
            <SkillPicker
              skills={AGENT_SKILLS}
              requestedIds={requestedSkillIds}
              activeIds={resolvedSkills.activeIds}
              requiredBy={resolvedSkills.requiredBy}
              disabled={working}
              onChange={setRequestedSkillIds}
            />
            <input
              ref={referenceInputRef}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              hidden
              onChange={(event) => {
                void importReferenceFiles(event.target.files);
              }}
            />
            <button
              type="button"
              className="reference-upload-button"
              disabled={working}
              title="上传参考 HTML 到 references/"
              aria-label="上传参考 HTML"
              onClick={() => referenceInputRef.current?.click()}
            >
              <Icon name="paperclip" size={14} />
              参考
            </button>
          </div>
          {referencePaths.length ? (
            <div className="reference-chips" aria-label="已导入的参考 HTML">
              {referencePaths.map((path) => (
                <span key={path} title={path}>
                  {path.replace(/^references\//, "")}
                  <button
                    type="button"
                    aria-label={`删除 ${path}`}
                    disabled={working}
                    onClick={() => {
                      if (!window.confirm(`删除参考文件 ${path}？`)) return;
                      try {
                        sandbox.remove(path);
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : String(error));
                      }
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
            placeholder="描述你想构建或修改的内容…（可先点「参考」上传 HTML）"
            rows={3}
          />
          <div className="composer-actions">
            <span>{statusLabel(progress, configured)}</span>
            <div className="composer-actions-right">
              <ContextRing used={contextUsed} total={settings.contextWindow} />
              {working ? (
                <button type="button" onClick={stop} aria-label="停止" className="stop-button">
                  停止
                </button>
              ) : (
                <button type="submit" disabled={!prompt.trim()} aria-label="发送">
                  <Icon name="send" size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="composer-note">流式 Plan → Executor：边改文件边输出回复</p>
      </div>
    </aside>
  );
}

function RuntimeConsole({
  logs,
  onClear,
  onClose,
  onFixError,
}: {
  logs: ConsoleLog[];
  onClear: () => void;
  onClose: () => void;
  onFixError: (message: string) => void;
}) {
  return (
    <section className="runtime-console">
      <header><span><Icon name="terminal" size={14} />控制台 <i>{logs.length}</i></span><div><button onClick={onClear}>清空</button><button className="icon-button subtle" onClick={onClose}><Icon name="close" size={14} /></button></div></header>
      <div className="console-lines">
        {logs.length === 0 ? <p className="console-empty">运行时日志会显示在这里。</p> : logs.map((log, index) => (
          <p className={`console-${log.level}`} key={index}>
            <time>{log.time}</time>
            {log.level === "error" ? (
              <button
                type="button"
                className="console-level-fix"
                title="点击让 Agent 智能修复"
                onClick={() => onFixError(log.message)}
              >
                {log.level}
              </button>
            ) : (
              <span>{log.level}</span>
            )}
            {log.message}
          </p>
        ))}
      </div>
    </section>
  );
}

function PreviewPane({
  sessionId,
  revision,
  status,
  viewport,
  onViewport,
  logs,
  onReload,
  onOpen,
  showConsole,
  onToggleConsole,
  onClearLogs,
  onFixError,
  pickMode,
  onPickMode,
  onElementPicked,
}: {
  sessionId: string;
  revision: number;
  status: RuntimeStatus;
  viewport: Viewport;
  onViewport: (viewport: Viewport) => void;
  logs: ConsoleLog[];
  onReload: () => void;
  onOpen: () => void;
  showConsole: boolean;
  onToggleConsole: () => void;
  onClearLogs: () => void;
  onFixError: (message: string) => void;
  pickMode: boolean;
  onPickMode: (enabled: boolean) => void;
  onElementPicked: (pick: {
    tag: string;
    id?: string;
    className?: string;
    text?: string;
    selector?: string;
    component?: string;
    html?: string;
  }) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const widths: Record<Viewport, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };
  const viewportLabel: Record<Viewport, string> = { desktop: "桌面", tablet: "平板", mobile: "手机" };

  function postPickMode(enabled: boolean) {
    iframeRef.current?.contentWindow?.postMessage(
      { source: "browser-esm-studio", type: "pick-mode", enabled },
      "*",
    );
  }

  useEffect(() => {
    postPickMode(pickMode);
  }, [pickMode, revision]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const data = event.data;
      if (data?.source !== "browser-esm-preview") return;
      if (data.type === "ready" && pickMode) postPickMode(true);
      if (data.type === "element-picked" && data.payload) {
        onPickMode(false);
        onElementPicked(data.payload);
      }
      if (data.type === "pick-cancelled") onPickMode(false);
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [pickMode, onPickMode, onElementPicked]);

  return (
    <section className="preview-pane">
      <div className="browser-bar">
        <div className="traffic"><i /><i /><i /></div>
        <div className="address-row">
          <div className="address">
            <span className={`runtime-dot ${status}`} />
            <span>preview.local/{sessionId}</span>
          </div>
          <button
            type="button"
            className={`pick-button ${pickMode ? "active" : ""}`}
            title="指哪改哪"
            aria-label="指哪改哪"
            aria-pressed={pickMode}
            onClick={() => onPickMode(!pickMode)}
          >
            <Icon name="sparkle" size={14} />
          </button>
        </div>
        <div className="browser-actions">
          <div className="viewport-switcher">
            {(["desktop", "tablet", "mobile"] as const).map((item) => <button className={viewport === item ? "active" : ""} onClick={() => onViewport(item)} title={viewportLabel[item]} key={item}><Icon name={item} size={15} /></button>)}
          </div>
          <button onClick={onReload} title="刷新预览"><Icon name="refresh" size={15} /></button>
          <button onClick={onOpen} title="新窗口打开"><Icon name="external" size={15} /></button>
        </div>
      </div>
      {pickMode && <div className="pick-banner">指哪改哪已开启 — 在预览中点击要改的元素，Esc 取消</div>}
      <div className="preview-canvas">
        {status === "error" ? <div className="preview-error"><strong>预览启动失败</strong><span>请查看控制台错误信息</span></div> : (
          <div className="device-frame" style={{ width: widths[viewport] }}>
            {revision > 0 && (
              <iframe
                ref={iframeRef}
                title="项目预览"
                src={previewUrl(sessionId, revision)}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"
              />
            )}
          </div>
        )}
      </div>
      {showConsole && <RuntimeConsole logs={logs} onClear={onClearLogs} onClose={onToggleConsole} onFixError={onFixError} />}
      <div className="preview-footer">
        <button className={`console-toggle ${logs.some((item) => item.level === "error") ? "has-error" : ""}`} onClick={onToggleConsole}><Icon name="terminal" size={14} />控制台 {logs.length > 0 && <i>{logs.length}</i>}</button>
      </div>
    </section>
  );
}

type PreviewMessage =
  | { source: "browser-esm-preview"; type: "ready" }
  | { source: "browser-esm-preview"; type: "error"; payload?: { stack?: string; message?: string } }
  | { source: "browser-esm-preview"; type: "console"; payload: { level: LogLevel; args: string[] } };

export function App() {
  const sandboxRef = useRef<Sandbox | null>(null);
  if (!sandboxRef.current) sandboxRef.current = createSandbox(loadFiles());
  const sandbox = sandboxRef.current;

  const previewConsoleRef = useRef<ReturnType<typeof createPreviewConsole> | null>(null);
  if (!previewConsoleRef.current) previewConsoleRef.current = createPreviewConsole();
  const previewConsole = previewConsoleRef.current;

  const [files, setFiles] = useState<FileMap>(() => sandbox.snapshot);
  const [activeFile, setActiveFile] = useState("src/App.tsx");
  const [mode, setMode] = useState<WorkspaceMode>("preview");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [revision, setRevision] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("syncing");
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [typechecking, setTypechecking] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const agentSubmitRef = useRef<((text: string) => void) | null>(null);

  function openMobilePreview() {
    setMode("preview");
    setMobilePreviewOpen(true);
  }

  function closeMobilePreview() {
    setMobilePreviewOpen(false);
  }

  useEffect(() => sandbox.subscribe(setFiles), [sandbox]);

  useEffect(() => previewConsole.subscribe(() => setLogs(previewConsole.getLogs())), [previewConsole]);

  useEffect(() => {
    if (!mobilePreviewOpen) return;
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") closeMobilePreview();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobilePreviewOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    function onChange() {
      if (!media.matches) setMobilePreviewOpen(false);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    requestAgentNotifyPermission();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projectId = await ensureDdbProject();
        if (cancelled) return;
        ensureDdbStack(sandbox, {
          projectId,
          userId: getDynamicDbUserId(),
          roles: resolveDynamicDbUserRoles(),
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[ddb] ensure failed:", message);
        previewConsole.push("warn", `Dynamic DB 初始化失败: ${message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sandbox, previewConsole]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      previewConsole.push(
        "error",
        `项目过大，无法写入本地存储（可删除 references/ 下的大 HTML 后重试）：${message}`,
      );
    }
    setRuntimeStatus("syncing");
    previewConsole.markDirty();
    const timer = window.setTimeout(() => {
      const syncToken = previewConsole.beginSync();
      syncPreviewProject(SESSION_ID, files)
        .then(() => {
          if (!previewConsole.endSync(syncToken)) return;
          setRuntimeStatus("ready");
          setRevision((value) => value + 1);
        })
        .catch((error: unknown) => {
          if (!previewConsole.failSync(syncToken)) return;
          setRuntimeStatus("error");
          setShowConsole(true);
          const message = error instanceof Error ? error.message : String(error);
          previewConsole.push("error", message);
        });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [files, previewConsole]);

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent<PreviewMessage>) {
      if (event.data?.source !== "browser-esm-preview") return;
      if (event.data.type === "ready") setRuntimeStatus("ready");
      if (event.data.type === "error" || (event.data.type === "console" && event.data.payload?.level === "error")) {
        setRuntimeStatus("error");
        setShowConsole(true);
      }
      previewConsole.handleMessage(event.data);
    }
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [previewConsole]);

  function updateFile(source: string) {
    sandbox.write(activeFile, source);
  }

  function addFile() {
    const input = window.prompt("输入新文件路径，例如 src/components/Card.tsx");
    const path = normalizePath(input);
    if (!path) return;
    try {
      sandbox.add(path, "");
      setActiveFile(path);
      setMode("code");
    } catch (error) {
      if (error instanceof SandboxError && error.code === "ALREADY_EXISTS") {
        window.alert("该文件已存在。");
        setActiveFile(path);
        return;
      }
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function deleteFile() {
    if (!activeFile) return;
    if (!window.confirm(`确定删除 ${activeFile}？`)) return;
    try {
      sandbox.remove(activeFile);
      const nextActive = sandbox.list()[0] || "";
      setActiveFile(nextActive);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }

  function exportZip() {
    downloadProjectZip(files, "orbit-preview-project.zip");
  }

  const manualReload = () => {
    setRuntimeStatus("syncing");
    const syncToken = previewConsole.beginSync();
    syncPreviewProject(SESSION_ID, files).then(() => {
      if (!previewConsole.endSync(syncToken)) return;
      setRevision((value) => value + 1);
      setRuntimeStatus("ready");
    }).catch((error: unknown) => {
      if (!previewConsole.failSync(syncToken)) return;
      setRuntimeStatus("error");
      setShowConsole(true);
      const message = error instanceof Error ? error.message : String(error);
      previewConsole.push("error", message);
    });
  };

  async function runTypecheck() {
    if (typechecking) return;
    setTypechecking(true);
    setShowConsole(true);
    setMode("preview");
    previewConsole.push("info", "正在运行 TypeScript 检查（tsc --noEmit）…");
    try {
      const result = await typecheckProject(files);
      const lines = formatTypecheckDiagnostics(result);
      if (result.ok) {
        previewConsole.push(
          "info",
          `类型检查通过（${result.checkedFiles} 个文件，${result.diagnostics.length} 条提示）。`,
        );
      } else {
        previewConsole.push(
          "error",
          `类型检查失败：${result.diagnostics.filter((item) => item.category === "error").length} 个错误。`,
        );
        for (const message of lines) previewConsole.push("error", message);
      }
    } catch (error) {
      previewConsole.push(
        "error",
        `类型检查异常：${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setTypechecking(false);
    }
  }

  return (
    <div className="studio-shell">
      <ChatPanel
        sandbox={sandbox}
        getFiles={() => files}
        submitRef={agentSubmitRef}
        getPreviewErrors={() => previewConsole.getErrors()}
        waitForPreviewErrors={(settleMs = 1800) => previewConsole.waitForErrors(settleMs)}
        onOpenPreview={openMobilePreview}
      />
      <div
        className={`mobile-preview-backdrop ${mobilePreviewOpen ? "is-open" : ""}`}
        onClick={closeMobilePreview}
        aria-hidden={!mobilePreviewOpen}
      />
      <main
        className={`workspace ${mobilePreviewOpen ? "is-mobile-dialog-open" : ""}`}
        role={mobilePreviewOpen ? "dialog" : undefined}
        aria-modal={mobilePreviewOpen || undefined}
        aria-label={mobilePreviewOpen ? "预览" : undefined}
      >
        <header className="workspace-header">
          <button
            type="button"
            className="mobile-preview-close icon-button subtle"
            title="关闭预览"
            aria-label="关闭预览"
            onClick={closeMobilePreview}
          >
            <Icon name="close" size={16} />
          </button>
          <div className="project-title">
            <span className="project-mark"><img src="/logo.png" alt="" /></span>
            <span className="project-title-copy"><strong>LLM-HTML</strong><span>
              <i />已自动保存</span></span>
          </div>
          <div className="workspace-tabs">
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Icon name="eye" size={15} />预览</button>
            <button className={mode === "code" ? "active" : ""} onClick={() => { setPickMode(false); setMode("code"); }}><Icon name="code" size={15} />代码</button>
          </div>
          <div className="workspace-actions">
            <button className="ghost-button" disabled={typechecking} onClick={() => void runTypecheck()} title="浏览器内 TypeScript 检查">
              <Icon name="check" size={15} />{typechecking ? "检查中…" : "类型检查"}
            </button>
            <button className="publish-button" onClick={exportZip}><Icon name="download" size={15} />导出 ZIP</button>
          </div>
        </header>
        <div className="workspace-body">
          {/* Keep Preview iframe mounted in code mode so runtime console errors still arrive. */}
          <div className={`code-workspace ${mode === "code" ? "" : "is-hidden"}`}>
            <FileExplorer files={files} activeFile={activeFile} onSelect={setActiveFile} onAdd={addFile} onDelete={deleteFile} />
            <CodeEditor path={activeFile} value={files[activeFile] || ""} onChange={updateFile} />
          </div>
          <div className={`preview-host ${mode === "preview" ? "" : "is-hidden"}`}>
            <PreviewPane
              sessionId={SESSION_ID}
              revision={revision}
              status={runtimeStatus}
              viewport={viewport}
              onViewport={setViewport}
              logs={logs}
              onReload={manualReload}
              onOpen={() => window.open(previewUrl(SESSION_ID, revision), "_blank", "noopener,noreferrer")}
              showConsole={showConsole}
              onToggleConsole={() => setShowConsole((value) => !value)}
              onClearLogs={() => previewConsole.clear()}
              onFixError={(message) => {
                agentSubmitRef.current?.(
                  `请修复 Preview 控制台报错，不要改无关文件：\n- ${message}`,
                );
              }}
              pickMode={pickMode}
              onPickMode={setPickMode}
              onElementPicked={(pick) => {
                const instruction = window.prompt("指哪改哪：想怎么改这个元素？");
                if (!instruction?.trim()) return;
                agentSubmitRef.current?.(formatElementPickPrompt(pick, instruction));
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
