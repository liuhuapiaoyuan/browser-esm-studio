/** Immutable virtual-file snapshot. Mutate only through Sandbox SDK. */
export type FileMap = Readonly<Record<string, string>>;

export type RuntimeStatus = "syncing" | "ready" | "error";

export type Viewport = "desktop" | "tablet" | "mobile";

export type WorkspaceMode = "preview" | "code";

export type LogLevel = "log" | "info" | "warn" | "error";

export type ConsoleLog = {
  level: LogLevel;
  message: string;
  time: string;
};

export type ChatPlanStep = {
  id: string;
  title: string;
  detail: string;
  files?: string[];
};

export type AgentToolActivity = {
  id: string;
  name: string;
  /** Human-readable label (e.g. Agent CLI command title); preferred over name in UI. */
  title?: string;
  detail?: string;
  status: "running" | "completed" | "error";
  durationMs?: number;
  error?: string;
  /** Decoded file body while write/add/replace args stream in (or at execute). */
  content?: string;
  /** True while the model is still streaming tool-call JSON. */
  inputStreaming?: boolean;
};

/** Ordered stream of assistant activity (reasoning segments + tools). */
export type ChatTimelinePart =
  | { type: "reasoning"; id: string; text: string; streaming?: boolean }
  | { type: "tool"; tool: AgentToolActivity };

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  plan?: {
    summary: string;
    approach?: string;
    steps: ChatPlanStep[];
  };
  /** Chronological reasoning / tool activity for this turn. */
  parts?: ChatTimelinePart[];
  streaming?: boolean;
};
