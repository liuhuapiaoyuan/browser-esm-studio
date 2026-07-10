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
  detail?: string;
  status: "running" | "completed" | "error";
  durationMs?: number;
  error?: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  reasoning?: string;
  reasoningStreaming?: boolean;
  plan?: {
    summary: string;
    steps: ChatPlanStep[];
  };
  tools?: AgentToolActivity[];
  streaming?: boolean;
};
