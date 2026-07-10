import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox";
import { formatTypecheckDiagnostics, typecheckProject } from "../typecheck";

/** Browser tsc --noEmit for the executor to self-verify before finishing. */
export function createTypecheckTools(sandbox: Sandbox) {
  return {
    typecheck: tool({
      description:
        "Run TypeScript typecheck (strict) on the virtual project. Call after editing .ts/.tsx and fix reported errors before finishing. Returns ok=false with diagnostics when there are errors.",
      inputSchema: z.object({
        // Some OpenAI-compatible models reject empty tool schemas.
        scope: z.literal("project").optional().describe("Optional; omit or pass project"),
      }),
      execute: async () => {
        const result = await typecheckProject(sandbox.snapshot);
        const errors = result.diagnostics.filter((item) => item.category === "error");
        const lines = formatTypecheckDiagnostics(
          { ...result, diagnostics: errors.length ? errors : result.diagnostics },
          20,
        );
        return {
          ok: result.ok,
          checkedFiles: result.checkedFiles,
          errorCount: errors.length,
          diagnostics: lines,
          hint: result.ok
            ? undefined
            : "Fix these before finishing. Common: TS7006 annotate callback params (e.g. (v: string) =>); TS2322/2339 readFile the symbol and match real types.",
        };
      },
    }),
  };
}

export type TypecheckTools = ReturnType<typeof createTypecheckTools>;
