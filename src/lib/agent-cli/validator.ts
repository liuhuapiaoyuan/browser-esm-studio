import type { z } from "zod";
import type { CommandErrorInfo } from "./protocol";

export type ValidateOk<T> = { ok: true; data: T };
export type ValidateFail = { ok: false; error: CommandErrorInfo };

function formatIssue(issue: z.ZodIssue): string {
  const path = issue.path.length ? issue.path.map(String).join(".") : "(root)";
  if (issue.code === "invalid_type") {
    const expected = "expected" in issue ? String(issue.expected) : "value";
    const received = "received" in issue ? String(issue.received) : "invalid";
    if (received === "undefined") {
      return `${path}: 缺少必填字段（期望 ${expected}）`;
    }
    return `${path}: 期望 ${expected}，实际是 ${received}`;
  }
  if (issue.code === "invalid_value" || issue.code === "invalid_union") {
    const options =
      "options" in issue && Array.isArray((issue as { options?: unknown }).options)
        ? `（允许: ${((issue as { options: unknown[] }).options).map(String).join(" | ")}）`
        : "";
    return `${path}: ${issue.message}${options}`;
  }
  return `${path}: ${issue.message}`;
}

export function validateInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
): ValidateOk<T> | ValidateFail {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const issues = parsed.error.issues;
  const first = issues[0];
  const field =
    first?.path?.length ? `/${first.path.map(String).join("/")}` : undefined;
  const suggestions = issues.slice(0, 8).map(formatIssue);
  const missing = issues
    .filter(
      (issue) =>
        issue.code === "invalid_type" &&
        "received" in issue &&
        issue.received === "undefined",
    )
    .map((issue) => issue.path.map(String).join(".") || "(root)");

  const messageParts = [
    suggestions[0] ?? "参数校验失败",
    missing.length ? `缺少: ${missing.join(", ")}` : null,
  ].filter(Boolean);

  return {
    ok: false,
    error: {
      code: "INVALID_ARGUMENT",
      message: messageParts.join("。"),
      retryable: true,
      field,
      details: {
        issues,
        receivedKeys:
          input && typeof input === "object" && !Array.isArray(input)
            ? Object.keys(input as object)
            : [],
        received: input,
      },
      suggestions: [
        ...suggestions,
        "确认参数写在 cli_execute.arguments 内（也可平铺在顶层，运行时会合并）",
        "不确定时先 cli_describe 该命令",
      ],
      recovery: [
        {
          action: "describe",
          reason: "重新读取命令参数说明后修正 arguments",
        },
      ],
    },
  };
}
