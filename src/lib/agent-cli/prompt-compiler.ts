import { z } from "zod";
import type { DefinedCommand } from "./protocol";

function schemaFieldLines(schema: z.ZodType, detail: "short" | "full"): string[] {
  try {
    const json = z.toJSONSchema(schema, { io: "input" }) as {
      type?: string;
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const props = json.properties ?? {};
    const required = new Set(json.required ?? []);
    const lines: string[] = [];
    for (const [key, prop] of Object.entries(props)) {
      const type = typeof prop.type === "string" ? prop.type : "unknown";
      const desc = typeof prop.description === "string" ? prop.description : "";
      const def = "default" in prop ? ` default=${JSON.stringify(prop.default)}` : "";
      const req = required.has(key) ? "required" : "optional";
      if (detail === "short") {
        lines.push(`- ${key} (${type}, ${req})${desc ? `: ${desc}` : ""}`);
      } else {
        lines.push(`${key}`);
        lines.push(`  type: ${type}`);
        lines.push(`  ${req}${def}`);
        if (desc) lines.push(`  description: ${desc}`);
        lines.push("");
      }
    }
    return lines;
  } catch {
    return ["(schema unavailable)"];
  }
}

export function compileSearchPrompt(cmd: DefinedCommand): string {
  const use = cmd.agent.useWhen.slice(0, 3).join("、");
  return [`${cmd.metadata.name}`, cmd.metadata.summary, use ? `适用于：${use}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function compileAgentPrompt(cmd: DefinedCommand, detail: "short" | "full" = "full"): string {
  const lines: string[] = [
    "COMMAND",
    cmd.metadata.name,
    "",
    "PURPOSE",
    cmd.agent.purpose,
    "",
    "USE WHEN",
    ...cmd.agent.useWhen.map((s) => `- ${s}`),
  ];

  if (cmd.agent.avoidWhen?.length) {
    lines.push("", "DO NOT USE WHEN", ...cmd.agent.avoidWhen.map((s) => `- ${s}`));
  }

  if (cmd.agent.instructions?.length && detail === "full") {
    lines.push("", "INSTRUCTIONS", ...cmd.agent.instructions.map((s) => `- ${s}`));
  }

  lines.push("", "INPUT", ...schemaFieldLines(cmd.inputSchema, detail));

  lines.push(
    "SAFETY",
    `risk: ${cmd.safety.risk}`,
    `sideEffect: ${cmd.safety.sideEffect}`,
    `idempotent: ${cmd.safety.idempotent}`,
  );

  if (detail === "full" && cmd.agent.examples.length) {
    lines.push("", "EXAMPLES");
    for (const ex of cmd.agent.examples.slice(0, 3)) {
      lines.push(`- user: ${ex.userRequest}`);
      lines.push(`  input: ${JSON.stringify(ex.input)}`);
      if (ex.explanation) lines.push(`  note: ${ex.explanation}`);
    }
  }

  if (detail === "full" && cmd.recovery?.errors) {
    lines.push("", "RECOVERY");
    for (const [code, info] of Object.entries(cmd.recovery.errors)) {
      lines.push(`${code}: ${info.description}`);
      for (const s of info.suggestions) lines.push(`  - ${s}`);
    }
  }

  return lines.join("\n").trim();
}

export function compileRecoveryPrompt(
  cmd: DefinedCommand,
  errorCode: string,
  message: string,
): string {
  const spec = cmd.recovery?.errors?.[errorCode];
  const lines = [
    `${cmd.metadata.name} 执行失败。`,
    "",
    "错误：",
    errorCode,
    message,
    "",
    `允许自动恢复：${spec?.retryable ? "是" : "否"}`,
  ];
  if (spec?.suggestions.length) {
    lines.push("", "建议：", ...spec.suggestions.map((s) => `- ${s}`));
  }
  if (cmd.recovery?.maxAutoRetries != null) {
    lines.push("", `限制：最多自动重试 ${cmd.recovery.maxAutoRetries} 次（由 Agent 决策，Runtime 不自动连环执行）。`);
  }
  return lines.join("\n");
}

export function describeCommandJson(cmd: DefinedCommand) {
  let inputJson: unknown;
  let outputJson: unknown;
  try {
    inputJson = z.toJSONSchema(cmd.inputSchema, { io: "input" });
  } catch {
    inputJson = null;
  }
  if (cmd.outputSchema) {
    try {
      outputJson = z.toJSONSchema(cmd.outputSchema, { io: "output" });
    } catch {
      outputJson = null;
    }
  }
  return {
    apiVersion: cmd.apiVersion,
    metadata: cmd.metadata,
    agent: cmd.agent,
    safety: cmd.safety,
    execution: cmd.execution,
    recovery: cmd.recovery,
    schema: {
      input: inputJson,
      output: outputJson,
    },
  };
}
