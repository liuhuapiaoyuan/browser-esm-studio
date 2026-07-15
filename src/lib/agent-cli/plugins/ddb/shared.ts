import type { Sandbox } from "../../../sandbox";
import { DynamicDbApiError } from "../../../../database/dynamic-db-api";
import { ensureDdbProject, getBoundDdbProjectId } from "../../../../database/project-binding";
import { AgentCliCommandError } from "../../protocol";

export async function resolveProjectId(): Promise<string> {
  let projectId = getBoundDdbProjectId();
  if (!projectId) {
    try {
      projectId = await ensureDdbProject();
    } catch (e) {
      throw new AgentCliCommandError(
        "DEPENDENCY_MISSING",
        e instanceof Error ? e.message : String(e),
        {
          retryable: true,
          suggestions: ["确认 Dynamic DB 已绑定项目后再重试"],
        },
      );
    }
  }
  return projectId;
}

export function applyGeneratedFiles(sandbox: Sandbox, files: Record<string, string>): string[] {
  const ops = Object.entries(files).map(([path, content]) =>
    sandbox.exists(path)
      ? ({ type: "write" as const, path, content })
      : ({ type: "add" as const, path, content }),
  );
  if (ops.length === 0) return [];
  return sandbox.apply(ops).changed;
}

export function mapDynamicDbError(e: unknown): never {
  if (e instanceof AgentCliCommandError) throw e;
  if (e instanceof DynamicDbApiError) {
    const errorCode =
      typeof e.body === "object" &&
      e.body !== null &&
      "error_code" in e.body &&
      typeof (e.body as { error_code: unknown }).error_code === "string"
        ? (e.body as { error_code: string }).error_code
        : e.status === 404
          ? "RESOURCE_NOT_FOUND"
          : e.status === 409
            ? "RESOURCE_CONFLICT"
            : e.status === 401 || e.status === 403
              ? "AUTH_REQUIRED"
              : "PROCESS_FAILED";
    throw new AgentCliCommandError(errorCode, e.message, {
      retryable: e.status >= 500 || e.status === 429,
      details: { status: e.status, body: e.body },
    });
  }
  throw new AgentCliCommandError(
    "INTERNAL_ERROR",
    e instanceof Error ? e.message : String(e),
    { retryable: false },
  );
}
