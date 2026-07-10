import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentToolActivity, ChatMessage } from "../../types";

const GLYPHS = {
  alert: ["M12 3 2.8 20h18.4L12 3Z", "M12 9v4", "M12 17h.01"],
  brain: [
    "M9.5 4A2.5 2.5 0 0 0 7 6.5v.2A3 3 0 0 0 5 12a3 3 0 0 0 2 5.3v.2A2.5 2.5 0 0 0 11.5 20V4.5A2.5 2.5 0 0 0 9.5 4Z",
    "M14.5 4A2.5 2.5 0 0 1 17 6.5v.2a3 3 0 0 1 2 5.3 3 3 0 0 1-2 5.3v.2a2.5 2.5 0 0 1-4.5 2.5V4.5A2.5 2.5 0 0 1 14.5 4Z",
    "M8 9.5h3.5",
    "M12.5 14H16",
  ],
  check: ["m5 12 4 4L19 6"],
  chevron: ["m8 10 4 4 4-4"],
  file: ["M6 3h8l4 4v14H6V3Z", "M14 3v5h4"],
  plan: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  tool: [
    "M14.7 6.3a4 4 0 0 0-5-5L12 4 9 7 6.3 4.3a4 4 0 0 0 5 5L4 16.6a2 2 0 0 0 2.8 2.8l7.4-7.4a4 4 0 0 0 5-5L16.5 9.7l-3-3 1.2-.4Z",
  ],
} as const;

type GlyphName = keyof typeof GLYPHS;

function Glyph({ name, size = 15 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      {GLYPHS[name].map((path) => <path d={path} key={path} />)}
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

  return (
    <section className={`ai-reasoning ${streaming ? "is-streaming" : ""}`}>
      <button aria-expanded={open} className="ai-disclosure-trigger" onClick={() => setOpen((value) => !value)} type="button">
        <span className="ai-activity-icon"><Glyph name="brain" /></span>
        <span className="ai-disclosure-copy">
          <strong className={streaming ? "shimmer-text" : ""}>{streaming ? "正在思考…" : "思考过程"}</strong>
          {!streaming && duration && <small>用时 {duration} 秒</small>}
        </span>
        <span className={`ai-chevron ${open ? "open" : ""}`}><Glyph name="chevron" size={14} /></span>
      </button>
      {open && (
        <div className="ai-reasoning-content">
          {text ? <p>{text}</p> : <div className="reasoning-skeleton"><i /><i /><i /></div>}
        </div>
      )}
    </section>
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
        <span className="ai-activity-icon plan"><Glyph name="plan" /></span>
        <span className="ai-disclosure-copy">
          <strong>实施计划</strong>
          <small>{plan.steps.length} 个步骤 · {streaming ? "执行中" : "已完成"}</small>
        </span>
        <span className="ai-plan-badge">{streaming ? "RUNNING" : "DONE"}</span>
        <span className={`ai-chevron ${open ? "open" : ""}`}><Glyph name="chevron" size={14} /></span>
      </button>
      {open && (
        <div className="ai-plan-content">
          <p className="ai-plan-summary">{plan.summary}</p>
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
};

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "";
  return durationMs < 1000 ? `${Math.max(1, Math.round(durationMs))} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

function ToolActivity({ tool }: { tool: AgentToolActivity }) {
  const [open, setOpen] = useState(tool.status === "running");
  const previousStatus = useRef(tool.status);

  useEffect(() => {
    let closeTimer: number | undefined;
    if (tool.status === "running") setOpen(true);
    if (previousStatus.current === "running" && tool.status === "completed") {
      closeTimer = window.setTimeout(() => setOpen(false), 650);
    }
    if (tool.status === "error") setOpen(true);
    previousStatus.current = tool.status;
    return () => {
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [tool.status]);

  const label = TOOL_LABELS[tool.name] || tool.name;
  return (
    <article className="ai-tool" data-status={tool.status}>
      <button aria-expanded={open} className="ai-tool-trigger" onClick={() => setOpen((value) => !value)} type="button">
        <span className="ai-tool-status">
          {tool.status === "running" ? <i /> : <Glyph name={tool.status === "error" ? "alert" : "check"} size={13} />}
        </span>
        <span className="ai-tool-copy">
          <strong>{label}</strong>
          {tool.detail && <small>{tool.detail}</small>}
        </span>
        <span className="ai-tool-badge">
          {tool.status === "running" ? "运行中" : tool.status === "error" ? "失败" : formatDuration(tool.durationMs) || "完成"}
        </span>
        <span className={`ai-chevron ${open ? "open" : ""}`}><Glyph name="chevron" size={13} /></span>
      </button>
      {open && (
        <div className="ai-tool-content">
          <span><Glyph name="tool" size={13} /> Sandbox Tool</span>
          <code>{tool.name}</code>
          {tool.error ? <p>{tool.error}</p> : <small>{tool.status === "running" ? "正在安全地操作虚拟文件…" : "调用已成功完成"}</small>}
        </div>
      )}
    </article>
  );
}

function ToolActivityList({ tools }: { tools: AgentToolActivity[] }) {
  const completed = tools.filter((tool) => tool.status === "completed").length;
  return (
    <section className="ai-tools">
      <header>
        <span><Glyph name="tool" size={14} /> 工具调用</span>
        <small>{completed}/{tools.length} 完成</small>
      </header>
      <div>{tools.map((tool) => <ToolActivity key={tool.id} tool={tool} />)}</div>
    </section>
  );
}

function ChangedFiles({ paths }: { paths: string[] }) {
  return (
    <section className="ai-changed-files">
      <header><span><Glyph name="file" size={14} /> 已更新文件</span><small>{paths.length}</small></header>
      {paths.map((path) => <div key={path}><code>{path}</code><span><Glyph name="check" size={12} /> 已修改</span></div>)}
    </section>
  );
}

export function AgentResponse({ message, status }: { message: ChatMessage; status: string }) {
  const tagged = useMemo(() => splitTaggedReasoning(message.text), [message.text]);
  const reasoning = useMemo(
    () => [...new Set([message.reasoning?.trim(), tagged.reasoning].filter((value): value is string => Boolean(value)))].join("\n\n"),
    [message.reasoning, tagged.reasoning],
  );
  const tools = message.tools ?? [];
  const hasActiveTool = tools.some((tool) => tool.status === "running");
  const showStatus = message.streaming && !message.reasoningStreaming && !hasActiveTool;

  return (
    <>
      {message.plan && <PlanPanel hasTools={tools.length > 0} plan={message.plan} streaming={Boolean(message.streaming)} />}
      <ReasoningPanel streaming={Boolean(message.reasoningStreaming)} text={reasoning} />
      {tools.length > 0 && <ToolActivityList tools={tools} />}
      {tagged.response && <MessageResponse streaming={message.streaming}>{tagged.response}</MessageResponse>}
      {message.changed?.length ? <ChangedFiles paths={message.changed} /> : null}
      {showStatus && (
        <div className="ai-live-status">
          <span className="ai-live-orbit"><i /></span>
          <span className="shimmer-text">{status}</span>
        </div>
      )}
    </>
  );
}
