import { z } from "zod";
import { formatTypecheckDiagnostics, typecheckProject } from "../../../../typecheck";
import { defineCommand } from "../../../define-command";
import { AgentCliCommandError } from "../../../protocol";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && window.setTimeout) {
      window.setTimeout(resolve, ms);
    } else {
      setTimeout(resolve, ms);
    }
  });
}

export const sandboxTypecheck = defineCommand({
  metadata: {
    name: "sandbox.typecheck",
    version: "1.0.0",
    title: "TypeScript 类型检查",
    summary: "对虚拟项目跑 strict typecheck；改 .ts/.tsx 后必须调用",
    tags: ["sandbox", "typecheck", "typescript", "verify"],
  },
  agent: {
    purpose: "编译期自检，修完再结束",
    useWhen: ["编辑过 .ts/.tsx", "结束前验证"],
    avoidWhen: ["只改了纯 CSS/文案且无 TS 影响时仍建议抽查"],
    instructions: [
      "ok=false（命令失败）时按 diagnostics 修复后再跑一遍",
      "常见 TS7006：给回调参数标注类型",
    ],
    examples: [{ userRequest: "检查类型有没有错", input: {} }],
  },
  inputSchema: z.object({
    scope: z.literal("project").optional().describe("Optional; omit or pass project"),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  recovery: {
    maxAutoRetries: 2,
    errors: {
      TYPECHECK_FAILED: {
        description: "存在 TypeScript 错误",
        retryable: true,
        suggestions: [
          "按 diagnostics 用 sandbox.replaceInFile 修复",
          "尤其注意 TS7006 回调参数类型",
          "修复后重新 sandbox.typecheck",
        ],
      },
    },
  },
  async execute(_input, ctx) {
    const result = await typecheckProject(ctx.sandbox.snapshot);
    const errors = result.diagnostics.filter((item) => item.category === "error");
    const lines = formatTypecheckDiagnostics(
      { ...result, diagnostics: errors.length ? errors : result.diagnostics },
      20,
    );
    if (!result.ok) {
      throw new AgentCliCommandError(
        "TYPECHECK_FAILED",
        lines.join("\n") || "Typecheck failed",
        {
          retryable: true,
          details: {
            checkedFiles: result.checkedFiles,
            errorCount: errors.length,
            diagnostics: lines,
          },
          suggestions: [
            "Fix these before finishing. Common: TS7006 annotate callback params; TS2322/2339 readFile the symbol and match real types.",
          ],
        },
      );
    }
    return {
      checkedFiles: result.checkedFiles,
      errorCount: 0,
      diagnostics: lines,
    };
  },
});

export const sandboxGetPreviewErrors = defineCommand({
  metadata: {
    name: "sandbox.getPreviewErrors",
    version: "1.0.0",
    title: "读取 Preview 运行时错误",
    summary: "读取 Preview iframe console 的 warn/error（运行时/转译/未捕获）",
    tags: ["sandbox", "preview", "runtime", "verify"],
  },
  agent: {
    purpose: "运行时自检，补 typecheck 覆盖不到的错误",
    useWhen: [
      "改了影响 Preview 的 UI/入口代码后",
      "prompt 里已有 preview console 错误",
    ],
    avoidWhen: ["纯 schema/codegen 且无 Preview 影响"],
    instructions: [
      "默认 wait=true，等 iframe 同步后再读",
      "有错误则修复后再次 sandbox.getPreviewErrors",
    ],
    examples: [
      {
        userRequest: "Preview 报错了吗",
        input: { wait: true },
      },
    ],
  },
  inputSchema: z.object({
    wait: z
      .boolean()
      .optional()
      .describe("Wait for Preview to settle after file sync (default true)"),
    waitMs: z
      .number()
      .int()
      .min(0)
      .max(8000)
      .optional()
      .describe("Settle time in ms when waiting (default 1800)"),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  recovery: {
    maxAutoRetries: 2,
    errors: {
      PREVIEW_ERRORS: {
        description: "Preview console 仍有 warn/error",
        retryable: true,
        suggestions: [
          "用 sandbox.replaceInFile 修复报错行",
          "再执行 sandbox.getPreviewErrors wait=true",
        ],
      },
      DEPENDENCY_MISSING: {
        description: "未注入 previewConsole",
        retryable: false,
        suggestions: ["宿主需提供 previewConsole 上下文"],
      },
    },
  },
  async execute(input, ctx) {
    const access = ctx.previewConsole;
    if (!access) {
      throw new AgentCliCommandError(
        "DEPENDENCY_MISSING",
        "previewConsole 未注入，无法读取 Preview 错误",
        { retryable: false },
      );
    }

    const shouldWait = input.wait !== false;
    const ms = input.waitMs ?? (shouldWait ? 1800 : 0);
    let errors: string[];
    if (shouldWait && ms > 0) {
      if (access.waitForErrors) {
        errors = await access.waitForErrors(ms);
      } else {
        await sleep(ms);
        errors = access.getErrors();
      }
    } else {
      errors = access.getErrors();
    }

    const lines = errors.slice(-20);
    if (lines.length > 0) {
      throw new AgentCliCommandError("PREVIEW_ERRORS", lines.join("\n"), {
        retryable: true,
        details: { count: lines.length, errors: lines },
        suggestions: [
          "Fix these Preview runtime errors before finishing. Prefer sandbox.replaceInFile; re-check with sandbox.getPreviewErrors wait=true.",
        ],
      });
    }
    return { count: 0, errors: [] as string[] };
  },
});
