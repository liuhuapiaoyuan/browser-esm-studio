import type { AgentResult } from "./agent";
import type { FileMap } from "../../types";
import type { TypecheckResult } from "../typecheck";

/** Extend this union as new lifecycle points are added. */
export type AgentHookEvent = {
  name: "agent:complete";
  prompt: string;
  result: AgentResult;
  aborted: boolean;
  getPreviewErrors: () => string[];
  /** Wait for Preview sync/reload, then return current warn/error lines. */
  waitForPreviewErrors: (settleMs?: number) => Promise<string[]>;
  getFiles: () => FileMap;
  typecheck: () => Promise<TypecheckResult>;
};

export type AgentHookApi = {
  /** Queue another agent turn (e.g. auto-fix). No-ops while an agent run is active. */
  followUp: (prompt: string) => void;
};

export type AgentHook = (event: AgentHookEvent, api: AgentHookApi) => void | Promise<void>;

const hooks: AgentHook[] = [];

export function registerAgentHook(hook: AgentHook): () => void {
  hooks.push(hook);
  return () => {
    const index = hooks.indexOf(hook);
    if (index >= 0) hooks.splice(index, 1);
  };
}

export async function runAgentHooks(event: AgentHookEvent, api: AgentHookApi): Promise<void> {
  for (const hook of hooks) {
    await hook(event, api);
  }
}

export const AUTO_FIX_PREFIX = "[auto-fix]";

/** After agent edits, if Preview still has runtime errors, kick off a fix turn. */
export function createAutoFixRuntimeHook(options?: {
  maxRounds?: number;
  settleMs?: number;
}): AgentHook {
  const maxRounds = options?.maxRounds ?? 2;
  const settleMs = options?.settleMs ?? 1800;
  let rounds = 0;

  return async (event, api) => {
    if (event.name !== "agent:complete" || event.aborted) return;

    if (!event.prompt.startsWith(AUTO_FIX_PREFIX)) rounds = 0;

    // Only worth checking after the agent actually changed files.
    if (!event.result.changed.length) return;

    const errors = await event.waitForPreviewErrors(settleMs);
    if (!errors.length) {
      rounds = 0;
      return;
    }
    if (rounds >= maxRounds) return;

    rounds += 1;
    api.followUp(
      `${AUTO_FIX_PREFIX} Preview runtime 报错，请修复（第 ${rounds}/${maxRounds} 次自动修复），不要改无关文件：\n${errors
        .slice(0, 12)
        .map((line) => `- ${line}`)
        .join("\n")}`,
    );
  };
}

/** After agent edits, run browser tsc --noEmit; auto-fix on type errors. */
export function createAutoFixTypecheckHook(options?: { maxRounds?: number }): AgentHook {
  const maxRounds = options?.maxRounds ?? 2;
  let rounds = 0;

  return async (event, api) => {
    if (event.name !== "agent:complete" || event.aborted) return;
    if (!event.prompt.startsWith(AUTO_FIX_PREFIX)) rounds = 0;
    if (!event.result.changed.length) return;

    // Prefer runtime auto-fix first when both fire in the same pass.
    const runtimeErrors = event.getPreviewErrors();
    if (runtimeErrors.length) return;

    const result = await event.typecheck();
    const errorLines = result.diagnostics
      .filter((item) => item.category === "error")
      .slice(0, 12)
      .map((item) => {
        const where = item.path ? `${item.path}:${item.line}:${item.column}` : "project";
        return `${where} TS${item.code}: ${item.message}`;
      });

    if (!errorLines.length) {
      rounds = 0;
      return;
    }
    if (rounds >= maxRounds) return;

    rounds += 1;
    api.followUp(
      `${AUTO_FIX_PREFIX} TypeScript 类型检查失败，请修复（第 ${rounds}/${maxRounds} 次自动修复），不要改无关文件：\n${errorLines
        .map((line) => `- ${line}`)
        .join("\n")}`,
    );
  };
}

/** Call from a user gesture (e.g. Send) so Chrome can show the permission prompt. */
export function requestAgentNotifyPermission(): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "default") return;
  void Notification.requestPermission();
}

/** Notify via Chrome/browser Notification when an agent turn finishes. */
export function createNotifyCompleteHook(): AgentHook {
  return async (event) => {
    if (event.name !== "agent:complete" || event.aborted) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

    const changed = event.result.changed.length;
    const summary = event.result.plan.summary || event.result.reply || "任务已完成";
    const body = changed > 0 ? `${summary}\n已改 ${changed} 个文件` : summary;

    try {
      const notification = new Notification("ESM Studio · 任务完成", {
        body: body.slice(0, 180),
        tag: "esm-studio-agent-complete",
        renotify: true,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {
      // Notification constructor can throw if permission flipped mid-flight.
    }
  };
}

registerAgentHook(createAutoFixRuntimeHook());
registerAgentHook(createAutoFixTypecheckHook());
registerAgentHook(createNotifyCompleteHook());
