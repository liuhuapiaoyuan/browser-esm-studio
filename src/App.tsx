import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AgentResponse } from "./components/ai-elements/agent-response";
import { DEFAULT_FILES } from "./defaultProject";
import { AGENT_SUGGESTIONS, formatAgentError, runPlanExecutorAgent, type AgentProgress } from "./lib/ai/agent";
import { requestAgentNotifyPermission, runAgentHooks } from "./lib/ai/hooks";
import { isAiConfigured, loadAiSettings, saveAiSettings, type AiSettings } from "./lib/ai/settings";
import { buildFileTree, fileLanguage, normalizePath, type TreeNode } from "./lib/path";
import { previewUrl, syncPreviewProject } from "./lib/preview";
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
  AgentToolActivity,
  ChatMessage,
  ConsoleLog,
  FileMap,
  LogLevel,
  RuntimeStatus,
  Viewport,
  WorkspaceMode,
} from "./types";

const STORAGE_KEY = "browser-esm-studio-project-v2";
const SESSION_ID = "workspace";

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
    case "planning":
      return "Planner 规划中…";
    case "planned":
      return `计划就绪 · ${progress.plan.steps.length} 步`;
    case "executing":
      return "Executor 执行中…";
    case "reasoning-start":
    case "reasoning-delta":
      return "Agent 思考中…";
    case "reasoning-end":
      return "思考完成，准备下一步…";
    case "tool":
      return `工具 ${progress.tool.name}${progress.tool.detail ? ` · ${progress.tool.detail}` : ""}`;
    case "text-delta":
      return "流式输出中…";
    case "done":
      return "完成";
  }
}

function ChatPanel({
  sandbox,
  getPreviewErrors,
  getFiles,
}: {
  sandbox: Sandbox;
  getPreviewErrors: () => string[];
  getFiles: () => FileMap;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "已接入真实 AI Agent（Plan → Executor，流式输出）。先在右上角配置你的 ChatGPT 兼容 API，然后描述想改的内容。",
    },
  ]);
  const [prompt, setPrompt] = useState("");
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AiSettings>(() => loadAiSettings());
  const [draft, setDraft] = useState<AiSettings>(() => loadAiSettings());
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingRef = useRef(false);
  const configured = isAiConfigured(settings);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, working, progress]);

  function persistSettings() {
    const next = {
      baseURL: draft.baseURL.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
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
  }

  async function submit(event: { preventDefault(): void } | null, suggestion?: string) {
    event?.preventDefault();
    const text = (suggestion || prompt).trim();
    if (!text || workingRef.current) return;

    if (!isAiConfigured(settings)) {
      setSettingsOpen(true);
      setMessages((current) => [
        ...current,
        { role: "user", text },
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
      { role: "user", text },
      { role: "assistant", text: "", streaming: true },
    ]);
    workingRef.current = true;
    setWorking(true);
    setProgress({ type: "planning" });

    const controller = new AbortController();
    abortRef.current = controller;
    const tools: AgentToolActivity[] = [];
    let completed: Awaited<ReturnType<typeof runPlanExecutorAgent>> | null = null;

    try {
      completed = await runPlanExecutorAgent(text, sandbox, {
        settings,
        history,
        previewErrors: getPreviewErrors(),
        abortSignal: controller.signal,
        onProgress: (event) => {
          setProgress(event);
          if (event.type === "planned") {
            updateStreamingMessage({ plan: event.plan });
          }
          if (event.type === "reasoning-start") {
            updateStreamingMessage({ reasoningStreaming: true });
          }
          if (event.type === "reasoning-delta") {
            updateStreamingMessage((message) => ({
              ...message,
              reasoning: `${message.reasoning ?? ""}${event.delta}`,
              reasoningStreaming: true,
            }));
          }
          if (event.type === "reasoning-end") {
            updateStreamingMessage({ reasoningStreaming: false });
          }
          if (event.type === "tool") {
            const index = tools.findIndex((tool) => tool.id === event.tool.id);
            if (index >= 0) tools[index] = event.tool;
            else tools.push(event.tool);
            updateStreamingMessage({ tools: [...tools] });
          }
          if (event.type === "text-delta") {
            updateStreamingMessage((message) => ({
              ...message,
              text: `${message.text}${event.delta}`,
            }));
          }
        },
      });
      updateStreamingMessage({
        text: completed.reply,
        reasoning: completed.reasoning,
        reasoningStreaming: false,
        changed: completed.changed,
        plan: completed.plan,
        tools: tools.length > 0 ? tools : undefined,
        streaming: false,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        updateStreamingMessage((message) => ({
          ...message,
          text: message.text.trim() || "已停止生成。",
          tools: tools.length > 0 ? tools : undefined,
          reasoningStreaming: false,
          streaming: false,
        }));
      } else {
        updateStreamingMessage((message) => ({
          ...message,
          text: `Agent 失败：${formatAgentError(error)}`,
          tools: tools.length > 0 ? tools : undefined,
          reasoningStreaming: false,
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
          waitForPreviewErrors: (settleMs = 1800) =>
            new Promise((resolve) => {
              window.setTimeout(() => resolve(getPreviewErrors()), settleMs);
            }),
          getFiles,
          typecheck: () => typecheckProject(getFiles()),
        },
        {
          followUp: (followUpPrompt) => {
            void submit(null, followUpPrompt);
          },
        },
      );
    }
  }

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <div className="brand-lockup">
          <span className="brand-icon"><Icon name="sparkle" size={17} /></span>
          <strong>ESM Studio</strong>
        </div>
        <button
          className="project-menu"
          title="API 设置"
          onClick={() => {
            setDraft(settings);
            setSettingsOpen((value) => !value);
          }}
        >
          <Icon name="settings" size={16} />
        </button>
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
          <div className="ai-settings-actions">
            <span>默认走 Vite 代理 /openai-proxy，避免 CORS</span>
            <button type="button" onClick={persistSettings}>保存</button>
          </div>
        </div>
      )}
      <div className="chat-context">
        <div>
          <span className={`pulse-dot ${configured ? "" : "warn"}`} />
          {configured ? "Plan · Executor · Stream" : "需要配置 API"}
        </div>
        <span>{settings.model || "未选模型"}</span>
      </div>
      <div className="messages" ref={scrollRef}>
        <div className="project-intro">
          <span className="intro-icon"><Icon name="sparkle" size={21} /></span>
          <div>
            <h2>Orbit 落地页</h2>
            <p>虚拟文件 · React · TypeScript · esm.sh · 流式 Agent</p>
          </div>
        </div>
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
            {message.role === "assistant" && (
              <span className="assistant-avatar"><Icon name="sparkle" size={13} /></span>
            )}
            <div className="message-content">
              {message.role === "assistant" ? (
                <AgentResponse message={message} status={statusLabel(progress, configured)} />
              ) : (
                <p>{message.text}</p>
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
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) submit(event);
            }}
            placeholder="描述你想构建或修改的内容…"
            rows={3}
          />
          <div className="composer-actions">
            <span>{statusLabel(progress, configured)}</span>
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
        </form>
        <p className="composer-note">流式 Plan → Executor：边改文件边输出回复</p>
      </div>
    </aside>
  );
}

function RuntimeConsole({ logs, onClear, onClose }: { logs: ConsoleLog[]; onClear: () => void; onClose: () => void }) {
  return (
    <section className="runtime-console">
      <header><span><Icon name="terminal" size={14} />控制台 <i>{logs.length}</i></span><div><button onClick={onClear}>清空</button><button className="icon-button subtle" onClick={onClose}><Icon name="close" size={14} /></button></div></header>
      <div className="console-lines">
        {logs.length === 0 ? <p className="console-empty">运行时日志会显示在这里。</p> : logs.map((log, index) => (
          <p className={`console-${log.level}`} key={index}><time>{log.time}</time><span>{log.level}</span>{log.message}</p>
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
}) {
  const widths: Record<Viewport, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };
  const viewportLabel: Record<Viewport, string> = { desktop: "桌面", tablet: "平板", mobile: "手机" };
  return (
    <section className="preview-pane">
      <div className="browser-bar">
        <div className="traffic"><i /><i /><i /></div>
        <div className="address"><span className={`runtime-dot ${status}`} />preview.local/{sessionId}</div>
        <div className="browser-actions">
          <div className="viewport-switcher">
            {(["desktop", "tablet", "mobile"] as const).map((item) => <button className={viewport === item ? "active" : ""} onClick={() => onViewport(item)} title={viewportLabel[item]} key={item}><Icon name={item} size={15} /></button>)}
          </div>
          <button onClick={onReload} title="刷新预览"><Icon name="refresh" size={15} /></button>
          <button onClick={onOpen} title="新窗口打开"><Icon name="external" size={15} /></button>
        </div>
      </div>
      <div className="preview-canvas">
        {status === "error" ? <div className="preview-error"><strong>预览启动失败</strong><span>请查看控制台错误信息</span></div> : (
          <div className="device-frame" style={{ width: widths[viewport] }}>
            {revision > 0 && <iframe title="项目预览" src={previewUrl(sessionId, revision)} sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads" />}
          </div>
        )}
      </div>
      {showConsole && <RuntimeConsole logs={logs} onClear={onClearLogs} onClose={onToggleConsole} />}
      <div className="preview-footer">
        <button className={`console-toggle ${logs.some((item) => item.level === "error") ? "has-error" : ""}`} onClick={onToggleConsole}><Icon name="terminal" size={14} />控制台 {logs.length > 0 && <i>{logs.length}</i>}</button>
        <span className="preview-engine">Service Worker · TypeScript · 原生 ESM · esm.sh</span>
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

  const [files, setFiles] = useState<FileMap>(() => sandbox.snapshot);
  const [activeFile, setActiveFile] = useState("src/App.tsx");
  const [mode, setMode] = useState<WorkspaceMode>("preview");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [revision, setRevision] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("syncing");
  const [logs, setLogs] = useState<ConsoleLog[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [typechecking, setTypechecking] = useState(false);

  useEffect(() => sandbox.subscribe(setFiles), [sandbox]);

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
        setLogs((current) => [
          ...current.slice(-99),
          {
            level: "warn",
            message: `Dynamic DB 初始化失败: ${message}`,
            time: new Date().toLocaleTimeString(),
          },
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sandbox]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    setRuntimeStatus("syncing");
    const timer = window.setTimeout(() => {
      syncPreviewProject(SESSION_ID, files)
        .then(() => {
          setLogs([]);
          setRuntimeStatus("ready");
          setRevision((value) => value + 1);
        })
        .catch((error: unknown) => {
          setRuntimeStatus("error");
          setShowConsole(true);
          const message = error instanceof Error ? error.message : String(error);
          setLogs((current) => [...current, { level: "error", message, time: new Date().toLocaleTimeString() }]);
        });
    }, 320);
    return () => window.clearTimeout(timer);
  }, [files]);

  const logsRef = useRef(logs);
  logsRef.current = logs;

  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent<PreviewMessage>) {
      if (event.data?.source !== "browser-esm-preview") return;
      const now = new Date().toLocaleTimeString();
      if (event.data.type === "ready") setRuntimeStatus("ready");
      if (event.data.type === "error") {
        setRuntimeStatus("error");
        setShowConsole(true);
        const message = event.data.payload?.stack || event.data.payload?.message || "Unknown error";
        setLogs((current) => [...current.slice(-99), { level: "error", message, time: now }]);
      }
      if (event.data.type === "console") {
        const payload = event.data.payload;
        if (payload.level === "error") {
          setRuntimeStatus("error");
          setShowConsole(true);
        }
        setLogs((current) => [...current.slice(-99), { level: payload.level, message: payload.args.join(" "), time: now }]);
      }
    }
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, []);

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
    setLogs([]);
    setRuntimeStatus("syncing");
    syncPreviewProject(SESSION_ID, files).then(() => {
      setRevision((value) => value + 1);
      setRuntimeStatus("ready");
    }).catch((error: unknown) => {
      setRuntimeStatus("error");
      setShowConsole(true);
      const message = error instanceof Error ? error.message : String(error);
      setLogs((current) => [...current, { level: "error", message, time: new Date().toLocaleTimeString() }]);
    });
  };

  async function runTypecheck() {
    if (typechecking) return;
    setTypechecking(true);
    setShowConsole(true);
    setMode("preview");
    const now = () => new Date().toLocaleTimeString();
    setLogs((current) => [...current, { level: "info", message: "正在运行 TypeScript 检查（tsc --noEmit）…", time: now() }]);
    try {
      const result = await typecheckProject(files);
      const lines = formatTypecheckDiagnostics(result);
      if (result.ok) {
        setLogs((current) => [
          ...current,
          {
            level: "info",
            message: `类型检查通过（${result.checkedFiles} 个文件，${result.diagnostics.length} 条提示）。`,
            time: now(),
          },
        ]);
      } else {
        setLogs((current) => [
          ...current,
          {
            level: "error",
            message: `类型检查失败：${result.diagnostics.filter((item) => item.category === "error").length} 个错误。`,
            time: now(),
          },
          ...lines.map((message) => ({ level: "error" as const, message, time: now() })),
        ]);
      }
    } catch (error) {
      setLogs((current) => [
        ...current,
        {
          level: "error",
          message: `类型检查异常：${error instanceof Error ? error.message : String(error)}`,
          time: now(),
        },
      ]);
    } finally {
      setTypechecking(false);
    }
  }

  return (
    <div className="studio-shell">
      <ChatPanel
        sandbox={sandbox}
        getFiles={() => files}
        getPreviewErrors={() =>
          logsRef.current
            .filter((log) => log.level === "error" || log.level === "warn")
            .map((log) => log.message)
        }
      />
      <main className="workspace">
        <header className="workspace-header">
          <div className="project-title"><strong>Orbit 落地页</strong><span>已本地保存</span></div>
          <div className="workspace-tabs">
            <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Icon name="eye" size={15} />预览</button>
            <button className={mode === "code" ? "active" : ""} onClick={() => setMode("code")}><Icon name="code" size={15} />代码</button>
          </div>
          <div className="workspace-actions">
            <button className="ghost-button" disabled={typechecking} onClick={() => void runTypecheck()} title="浏览器内 TypeScript 检查">
              <Icon name="check" size={15} />{typechecking ? "检查中…" : "类型检查"}
            </button>
            <button className="publish-button" onClick={exportZip}><Icon name="download" size={15} />导出 ZIP</button>
          </div>
        </header>
        <div className="workspace-body">
          {mode === "code" ? (
            <div className="code-workspace">
              <FileExplorer files={files} activeFile={activeFile} onSelect={setActiveFile} onAdd={addFile} onDelete={deleteFile} />
              <CodeEditor path={activeFile} value={files[activeFile] || ""} onChange={updateFile} />
            </div>
          ) : (
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
              onClearLogs={() => setLogs([])}
            />
          )}
        </div>
      </main>
    </div>
  );
}
