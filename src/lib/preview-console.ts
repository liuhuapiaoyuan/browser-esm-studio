import type { ConsoleLog, LogLevel } from "../types";

export type PreviewBridgeMessage =
  | { source: "browser-esm-preview"; type: "ready"; payload?: { title?: string; phase?: string } }
  | { source: "browser-esm-preview"; type: "error"; payload?: { stack?: string; message?: string } }
  | { source: "browser-esm-preview"; type: "console"; payload: { level: LogLevel; args: string[] } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function isPreviewBridgeMessage(data: unknown): data is PreviewBridgeMessage {
  if (!data || typeof data !== "object") return false;
  const message = data as { source?: unknown; type?: unknown };
  return message.source === "browser-esm-preview" && typeof message.type === "string";
}

/** Host-side collector for Preview iframe console / runtime errors. */
export function createPreviewConsole() {
  let logs: ConsoleLog[] = [];
  /** Bumped when Preview sync finishes and the iframe is about to reload. */
  let generation = 0;
  /** Last generation that sent a `ready` bridge message. */
  let readyGeneration = 0;
  let syncing = false;
  /** Files changed; a sync/reload is expected before errors are trustworthy. */
  let dirty = false;
  /** Invalidates in-flight sync completions when files change again. */
  let syncToken = 0;
  const listeners = new Set<() => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  function push(level: LogLevel, message: string) {
    const entry: ConsoleLog = {
      level,
      message,
      time: new Date().toLocaleTimeString(),
    };
    logs = [...logs.slice(-99), entry];
    emit();
  }

  function getErrors(): string[] {
    return logs
      .filter((log) => log.level === "error" || log.level === "warn")
      .map((log) => log.message);
  }

  function handleMessage(data: unknown) {
    if (!isPreviewBridgeMessage(data)) return false;

    if (data.type === "ready") {
      readyGeneration = generation;
      emit();
      return true;
    }

    if (data.type === "error") {
      const message = data.payload?.stack || data.payload?.message || "Unknown error";
      push("error", message);
      return true;
    }

    if (data.type === "console") {
      const payload = data.payload;
      if (!payload?.args) return true;
      push(payload.level, payload.args.join(" "));
      return true;
    }

    return false;
  }

  /**
   * Wait for Preview sync + iframe bridge ready, then settle so late
   * module/runtime errors (esm.sh, React effects) can arrive.
   */
  async function waitForErrors(settleMs = 1800): Promise<string[]> {
    const hardCap = Math.max(settleMs + 6000, 8000);
    const started = Date.now();
    const startGen = generation;

    while (Date.now() - started < hardCap) {
      // A sync completed since we started — wait until that iframe's bridge is ready.
      const reloaded = generation > startGen && readyGeneration >= generation;
      if (reloaded) break;

      // No sync happened — settle against the current iframe.
      if (!dirty && !syncing && generation === startGen && Date.now() - started >= 300) {
        break;
      }

      await sleep(50);
    }

    const readyAt = Date.now();
    while (Date.now() - readyAt < settleMs) {
      await sleep(100);
    }

    // Quiet window: keep waiting briefly if errors are still streaming in.
    for (let i = 0; i < 8; i += 1) {
      const before = getErrors().length;
      await sleep(150);
      if (getErrors().length === before) break;
    }

    return getErrors();
  }

  return {
    getLogs: () => logs,
    getErrors,
    waitForErrors,
    clear() {
      logs = [];
      emit();
    },
    markDirty() {
      dirty = true;
      syncToken += 1;
      emit();
    },
    beginSync(): number {
      syncing = true;
      dirty = true;
      syncToken += 1;
      emit();
      return syncToken;
    },
    endSync(token: number): boolean {
      if (token !== syncToken) return false;
      syncing = false;
      dirty = false;
      generation += 1;
      logs = [];
      emit();
      return true;
    },
    /** Sync failed — stop waiting, keep whatever logs we have. */
    failSync(token: number): boolean {
      if (token !== syncToken) return false;
      syncing = false;
      dirty = false;
      emit();
      return true;
    },
    markReload() {
      dirty = true;
      syncToken += 1;
      generation += 1;
      logs = [];
      emit();
    },
    isSyncing: () => syncing,
    isDirty: () => dirty,
    getGeneration: () => generation,
    handleMessage,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push,
  };
}

export type PreviewConsole = ReturnType<typeof createPreviewConsole>;
