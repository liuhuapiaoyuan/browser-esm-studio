import { tool } from "ai";
import { z } from "zod";

export type PreviewConsoleAccess = {
  /** Current warn/error lines from the Preview iframe console bridge. */
  getErrors: () => string[];
  /** Wait for Preview sync/reload, then return current warn/error lines. */
  waitForErrors?: (settleMs?: number) => Promise<string[]>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Preview runtime console for the executor — complements typecheck (compile-time). */
export function createPreviewTools(access: PreviewConsoleAccess) {
  return {
    getPreviewErrors: tool({
      description:
        "Read Preview iframe console warnings/errors (runtime, transpile, uncaught). After editing files that affect Preview, call with wait=true so the iframe can reload, then fix reported lines before finishing. Returns ok=true when the console has no warn/error.",
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
      execute: async ({ wait, waitMs }) => {
        const shouldWait = wait !== false;
        const ms = waitMs ?? (shouldWait ? 1800 : 0);
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
        return {
          ok: lines.length === 0,
          count: lines.length,
          errors: lines,
          hint: lines.length
            ? "Fix these Preview runtime errors before finishing. Prefer replaceInFile; re-check with getPreviewErrors(wait=true)."
            : undefined,
        };
      },
    }),
  };
}

export type PreviewTools = ReturnType<typeof createPreviewTools>;
