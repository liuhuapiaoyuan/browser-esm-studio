import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentToolActivity, ChatMessage } from "../../types";

const PLAN_GLYPHS = {
  plan: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  chevron: ["m8 10 4 4 4-4"],
} as const;

function PlanGlyph({ name, size = 15 }: { name: keyof typeof PLAN_GLYPHS; size?: number }) {
  return (
    <svg aria-hidden="true" fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width={size}>
      {PLAN_GLYPHS[name].map((path) => <path d={path} key={path} />)}
    </svg>
  );
}

export function splitTaggedReasoning(text: string): { reasoning: string; response: string } {
  const blocks: string[] = [];
  const response = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_match, content: string) => {
    const value = content.trim();
    if (value) blocks.push(value);
    return "";
  });
  return {
    reasoning: blocks.join("\n\n"),
    response: response.trimStart(),
  };
}

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; language: string; text: string };

function markdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: Extract<MarkdownBlock, { type: "list" }> | null = null;
  let code: { language: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const line of markdown.split("\n")) {
    if (code) {
      if (line.trim().startsWith("```")) {
        blocks.push({ type: "code", language: code.language, text: code.lines.join("\n") });
        code = null;
      } else {
        code.lines.push(line);
      }
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      code = { language: fence[1] || "", lines: [] };
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) flushList();
      list ??= { type: "list", ordered: isOrdered, items: [] };
      list.items.push((unordered?.[1] || ordered?.[1]) ?? "");
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (code) blocks.push({ type: "code", language: code.language, text: code.lines.join("\n") });
  flushParagraph();
  flushList();
  return blocks;
}

function MessageResponse({ children, streaming = false }: { children: string; streaming?: boolean }) {
  const blocks = useMemo(() => markdownBlocks(children), [children]);
  return (
    <div
      aria-live={streaming ? "polite" : undefined}
      className={`ai-message-response ${streaming ? "is-streaming" : ""}`}
    >
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          return <h3 className={`level-${block.level}`} key={index}><InlineText>{block.text}</InlineText></h3>;
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText>{item}</InlineText></li>)}</List>;
        }
        if (block.type === "code") {
          return (
            <pre className="ai-code-block" key={index}>
              {block.language && <span>{block.language}</span>}
              <code>{block.text}</code>
            </pre>
          );
        }
        return <p key={index}><InlineText>{block.text}</InlineText></p>;
      })}
      {streaming && <span className="stream-caret" />}
    </div>
  );
}

function ReasoningPanel({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const [duration, setDuration] = useState<number>();
  const startedAt = useRef<number | null>(streaming ? Date.now() : null);
  const wasStreaming = useRef(false);

  useEffect(() => {
    let closeTimer: number | undefined;
    if (streaming && !wasStreaming.current) {
      startedAt.current = Date.now();
      setDuration(undefined);
      setOpen(true);
    }
    if (!streaming && wasStreaming.current) {
      if (startedAt.current) setDuration(Math.max(1, Math.ceil((Date.now() - startedAt.current) / 1000)));
      startedAt.current = null;
      closeTimer = window.setTimeout(() => setOpen(false), 900);
    }
    wasStreaming.current = streaming;
    return () => {
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [streaming]);

  if (!text && !streaming) return null;

  const label = streaming
    ? "正在思考…"
    : duration
      ? `思考过程 · ${duration}s`
      : "思考过程";

  return (
    <div className="ai-fold">
      <button
        aria-expanded={open}
        className={`ai-fold-toggle ${streaming ? "shimmer-text" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {label}
      </button>
      {open && <p className="ai-fold-body">{text || "…"}</p>}
    </div>
  );
}

function PlanPanel({
  plan,
  streaming,
  hasTools,
}: {
  plan: NonNullable<ChatMessage["plan"]>;
  streaming: boolean;
  hasTools: boolean;
}) {
  const [open, setOpen] = useState(!hasTools);
  const hadTools = useRef(hasTools);

  useEffect(() => {
    let closeTimer: number | undefined;
    if (hasTools && !hadTools.current) closeTimer = window.setTimeout(() => setOpen(false), 700);
    hadTools.current = hasTools;
    return () => {
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [hasTools]);

  return (
    <section className="ai-plan">
      <button aria-expanded={open} className="ai-disclosure-trigger" onClick={() => setOpen((value) => !value)} type="button">
        <span className="ai-activity-icon plan"><PlanGlyph name="plan" /></span>
        <span className="ai-disclosure-copy">
          <strong>实施计划</strong>
          <small>{plan.steps.length} 个步骤 · {streaming ? "执行中" : "已完成"}</small>
        </span>
        <span className="ai-plan-badge">{streaming ? "RUNNING" : "DONE"}</span>
        <span className={`ai-chevron ${open ? "open" : ""}`}><PlanGlyph name="chevron" size={14} /></span>
      </button>
      {open && (
        <div className="ai-plan-content">
          <p className="ai-plan-summary">{plan.summary}</p>
          {plan.approach ? <p className="ai-plan-approach">{plan.approach}</p> : null}
          <ol>
            {plan.steps.map((step, index) => (
              <li key={step.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.detail}</p>
                  {step.files?.length ? <small>{step.files.join(" · ")}</small> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const TOOL_LABELS: Record<string, string> = {
  addFile: "创建文件",
  applyOperations: "批量更新",
  grep: "搜索代码",
  listFiles: "浏览项目",
  readFile: "读取文件",
  removeFile: "删除文件",
  replaceInFile: "编辑文件",
  typecheck: "类型检查",
  writeFile: "写入文件",
  cli_search: "搜索命令",
  cli_describe: "查看命令说明",
  cli_diagnose: "诊断失败",
  cli_execute: "执行命令",
};

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "";
  return durationMs < 1000 ? `${Math.max(1, Math.round(durationMs))}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

const FILE_BODY_TOOLS = new Set([
  "writeFile",
  "addFile",
  "replaceInFile",
  "sandbox.writeFile",
  "sandbox.addFile",
  "sandbox.replaceInFile",
]);
const FILE_BODY_TITLES = new Set(["写入文件", "新增文件", "替换文件片段"]);
const STREAM_CODE_MAX_LINES = 48;

function isFileBodyActivity(tool: AgentToolActivity): boolean {
  if (FILE_BODY_TOOLS.has(tool.name)) return true;
  if (tool.title && FILE_BODY_TITLES.has(tool.title)) return true;
  // cli_execute write/replace streams set content even while name stays cli_execute.
  return typeof tool.content === "string";
}

/** Split so the caret sits on the growing last line while file args stream. */
function StreamingFileContent({ content, streaming }: { content: string; streaming: boolean }) {
  const lines = content.split("\n");
  const omitted = Math.max(0, lines.length - STREAM_CODE_MAX_LINES);
  const visible = omitted > 0 ? lines.slice(-STREAM_CODE_MAX_LINES) : lines;
  const last = visible[visible.length - 1] ?? "";
  const head = visible.slice(0, -1);

  return (
    <pre className="ai-tool-code">
      {omitted > 0 ? <span className="ai-tool-code-omit">… {omitted} lines above{"\n"}</span> : null}
      {head.length > 0 ? `${head.join("\n")}\n` : null}
      <span className="ai-tool-code-tail">
        {last}
        {streaming ? <span className="stream-caret" /> : null}
      </span>
    </pre>
  );
}

function ToolActivity({ tool }: { tool: AgentToolActivity }) {
  const isFileBody = isFileBodyActivity(tool);
  const streamingArgs = Boolean(tool.inputStreaming);
  const hasContent = typeof tool.content === "string" && tool.content.length > 0;
  // Keep the code pane visible while args stream, while the tool runs, or when we
  // already decoded a body (completion used to wipe the preview).
  const showCode =
    isFileBody &&
    (hasContent || streamingArgs) &&
    (streamingArgs || tool.status === "running" || hasContent);
  const [open, setOpen] = useState(tool.status === "running" || streamingArgs || hasContent);
  const previousStatus = useRef(tool.status);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let closeTimer: number | undefined;
    if (tool.status === "running" || tool.inputStreaming) setOpen(true);
    if (previousStatus.current === "running" && tool.status === "completed") {
      closeTimer = window.setTimeout(() => setOpen(false), 650);
    }
    if (tool.status === "error") setOpen(true);
    previousStatus.current = tool.status;
    return () => {
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [tool.status, tool.inputStreaming]);

  useEffect(() => {
    if (!showCode || !tool.inputStreaming) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tool.content, showCode, tool.inputStreaming]);

  const name = tool.title || TOOL_LABELS[tool.name] || tool.name;
  const isReplace =
    tool.name === "replaceInFile" ||
    tool.name === "sandbox.replaceInFile" ||
    tool.title === "替换文件片段";
  const status =
    tool.inputStreaming
      ? isFileBody
        ? isReplace
          ? "流式编辑中"
          : "流式写入中"
        : "参数生成中"
      : tool.status === "running"
        ? "运行中"
        : tool.status === "aborted"
          ? "已停止"
          : tool.status === "error"
            ? "失败"
            : formatDuration(tool.durationMs) || "完成";
  const label = [name, tool.detail, status].filter(Boolean).join(" · ");
  const active = tool.status === "running" || tool.inputStreaming;

  return (
    <div className="ai-fold">
      <button
        aria-expanded={open}
        className={`ai-fold-toggle ${active ? "shimmer-text" : ""} ${tool.status === "error" ? "is-error" : ""} ${tool.status === "aborted" ? "is-aborted" : ""}`}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {label}
      </button>
      {open && (
        <div className="ai-fold-body" ref={bodyRef}>
          {tool.error
            ? tool.error
            : showCode
              ? <StreamingFileContent content={tool.content ?? ""} streaming={streamingArgs} />
              : tool.inputStreaming
                ? <StreamingFileContent content="" streaming />
                : tool.status === "running"
                  ? "正在操作…"
                  : tool.status === "aborted"
                    ? hasContent
                      ? <StreamingFileContent content={tool.content ?? ""} streaming={false} />
                      : "已停止"
                    : hasContent
                      ? <StreamingFileContent content={tool.content ?? ""} streaming={false} />
                      : `${name} 已完成`}
        </div>
      )}
    </div>
  );
}

function ChangedFiles({ paths }: { paths: string[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ai-fold">
      <button
        aria-expanded={open}
        className="ai-fold-toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        已更新 {paths.length} 个文件
      </button>
      {open && (
        <ul className="ai-fold-body">
          {paths.map((path) => <li key={path}>{path}</li>)}
        </ul>
      )}
    </div>
  );
}

export function AgentResponse({ message, status }: { message: ChatMessage; status: string }) {
  const tagged = useMemo(() => splitTaggedReasoning(message.text), [message.text]);
  const parts = message.parts ?? [];
  const hasTools = parts.some((part) => part.type === "tool");
  const hasReasoningParts = parts.some((part) => part.type === "reasoning");
  const hasActiveTool = parts.some((part) => part.type === "tool" && (part.tool.status === "running" || part.tool.inputStreaming));
  const reasoningStreaming = parts.some((part) => part.type === "reasoning" && part.streaming);
  const showStatus = message.streaming && !reasoningStreaming && !hasActiveTool;
  // Fallback when think tags land in text without stream reasoning parts.
  const fallbackReasoning = !hasReasoningParts ? tagged.reasoning : "";

  return (
    <>
      {message.plan && <PlanPanel hasTools={hasTools} plan={message.plan} streaming={Boolean(message.streaming)} />}
      {parts.map((part) => {
        if (part.type === "reasoning") {
          return <ReasoningPanel key={part.id} streaming={Boolean(part.streaming)} text={part.text} />;
        }
        return <ToolActivity key={part.tool.id} tool={part.tool} />;
      })}
      {fallbackReasoning ? <ReasoningPanel streaming={false} text={fallbackReasoning} /> : null}
      {tagged.response && <MessageResponse streaming={message.streaming}>{tagged.response}</MessageResponse>}
      {message.changed?.length ? <ChangedFiles paths={message.changed} /> : null}
      {showStatus && <p className="ai-fold-toggle shimmer-text">{status}</p>}
    </>
  );
}
