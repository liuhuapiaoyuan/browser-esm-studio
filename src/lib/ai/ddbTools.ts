import { tool } from "ai";
import { z } from "zod";
import type { Sandbox } from "../sandbox";
import {
  activateDynamicDbSchema,
  countDynamicDbRecords,
  createDynamicDbRecord,
  deleteDynamicDbRecord,
  dynamicDbRecordsBatch,
  DynamicDbApiError,
  getDynamicDbEffectiveSchema,
  getDynamicDbInventory,
  getDynamicDbProjectSchema,
  getDynamicDbRecord,
  initializeDynamicDbProject,
  listDynamicDbRecords,
  updateDynamicDbRecord,
  upsertDynamicDbRecord,
} from "../../database/dynamic-db-api";
import {
  formatDynamicDbSchemaValidationError,
  normalizeDynamicDbActivateBody,
  normalizeDynamicDbInitializeBody,
  schemaNeedsInitialize,
} from "../../database/dynamic-db-schema-normalize";
import { ensureDdbProject, getBoundDdbProjectId } from "../../database/project-binding";
import { codegenDdbProjectFiles } from "../../database/codegen";

const jsonObjectOrString = z.union([z.record(z.string(), z.unknown()), z.string()]).optional();

const OPERATIONS = [
  "getSchema",
  "getEffectiveSchema",
  "getInventory",
  "listRecords",
  "getRecord",
  "createRecord",
  "updateRecord",
  "deleteRecord",
  "recordsBatch",
  "countRecords",
  "upsertRecord",
  "activateSchema",
  "setupSchema",
  "initializeProject",
  "codegen",
] as const;

function applyGeneratedFiles(sandbox: Sandbox, files: Record<string, string>): string[] {
  const ops = Object.entries(files).map(([path, content]) =>
    sandbox.exists(path)
      ? ({ type: "write" as const, path, content })
      : ({ type: "add" as const, path, content }),
  );
  if (ops.length === 0) return [];
  return sandbox.apply(ops).changed;
}

export function createDdbTools(sandbox: Sandbox) {
  return {
    dynamicDb: tool({
      description:
        "Operate the bound project's Dynamic DB. Schema first: setupSchema with rootSchema.collections (object). Then operation codegen → getDb() in app. No curl/fetch.",
      inputSchema: z.object({
        operation: z
          .enum(OPERATIONS)
          .describe("DB operation. New schema: setupSchema. After schema: codegen."),
        kind: z.string().optional().describe("Collection kind (required for record ops)."),
        recordId: z.string().optional(),
        page: z.number().int().positive().optional(),
        pageSize: z.number().int().positive().max(50).optional(),
        where: z.record(z.string(), z.unknown()).optional(),
        payload: z.record(z.string(), z.unknown()).optional(),
        data: z.array(z.record(z.string(), z.unknown())).optional(),
        update: z.record(z.string(), z.unknown()).optional(),
        create: z.record(z.string(), z.unknown()).optional(),
        ids: z.array(z.string()).optional(),
        batchOperation: z
          .enum([
            "recordsBatchCreate",
            "recordsBatchUpdate",
            "recordsBatchDelete",
            "recordsUpsert",
          ])
          .optional(),
        cascade: z.boolean().optional(),
        populate: z.union([z.boolean(), z.array(z.string())]).optional(),
        rootSchema: jsonObjectOrString.describe(
          "setupSchema | activateSchema | initializeProject: { collections: { students: { type, properties, required } } }",
        ),
        initializeBody: jsonObjectOrString,
        intent: z.string().optional(),
      }),
      execute: async (input) => {
        let projectId = getBoundDdbProjectId();
        if (!projectId) {
          try {
            projectId = await ensureDdbProject();
          } catch (e) {
            return {
              ok: false as const,
              operation: input.operation,
              projectId: "",
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }

        const op = input.operation;

        try {
          let data: unknown;
          let hint: string | undefined;

          switch (op) {
            case "codegen": {
              const result = await codegenDdbProjectFiles(projectId);
              const changed = applyGeneratedFiles(sandbox, result.files);
              return {
                ok: true as const,
                operation: op,
                projectId,
                data: { kindNames: result.kindNames, schemaVersion: result.schemaVersion, changed },
                hint: "已写入 src/ddb/generated。请 Read kindNames，业务代码只用 getDb()。",
              };
            }
            case "getSchema":
              data = await getDynamicDbProjectSchema(projectId);
              break;
            case "getEffectiveSchema": {
              const kind = input.kind?.trim();
              if (!kind) {
                return { ok: false as const, operation: op, projectId, error: "getEffectiveSchema 需要 kind。" };
              }
              data = await getDynamicDbEffectiveSchema(projectId, kind);
              break;
            }
            case "getInventory":
              data = await getDynamicDbInventory();
              break;
            case "listRecords": {
              const kind = input.kind?.trim();
              if (!kind) {
                return { ok: false as const, operation: op, projectId, error: "listRecords 需要 kind。" };
              }
              data = await listDynamicDbRecords({
                projectId,
                kind,
                page: input.page,
                pageSize: input.pageSize,
                filter: input.where,
                populate: input.populate,
              });
              break;
            }
            case "getRecord": {
              const kind = input.kind?.trim();
              const recordId = input.recordId?.trim();
              if (!kind || !recordId) {
                return { ok: false as const, operation: op, projectId, error: "getRecord 需要 kind 与 recordId。" };
              }
              data = await getDynamicDbRecord({
                projectId,
                kind,
                recordId,
                populate: input.populate === true,
              });
              break;
            }
            case "createRecord": {
              const kind = input.kind?.trim();
              if (!kind || !input.payload) {
                return { ok: false as const, operation: op, projectId, error: "createRecord 需要 kind 与 payload。" };
              }
              data = await createDynamicDbRecord({ projectId, kind, payload: input.payload });
              break;
            }
            case "updateRecord": {
              const kind = input.kind?.trim();
              const recordId = input.recordId?.trim();
              if (!kind || !recordId || !input.payload) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: "updateRecord 需要 kind、recordId 与 payload。",
                };
              }
              data = await updateDynamicDbRecord({
                projectId,
                kind,
                recordId,
                payload: input.payload,
              });
              break;
            }
            case "deleteRecord": {
              const kind = input.kind?.trim();
              const recordId = input.recordId?.trim();
              if (!kind || !recordId) {
                return { ok: false as const, operation: op, projectId, error: "deleteRecord 需要 kind 与 recordId。" };
              }
              data = await deleteDynamicDbRecord({
                projectId,
                kind,
                recordId,
                cascade: input.cascade,
              });
              break;
            }
            case "recordsBatch": {
              const kind = input.kind?.trim();
              const batchOperation = input.batchOperation;
              if (!kind || !batchOperation) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: "recordsBatch 需要 kind 与 batchOperation。",
                };
              }
              data = await dynamicDbRecordsBatch({
                operation: batchOperation,
                projectId,
                kind,
                ...(input.data ? { data: input.data } : {}),
                ...(input.where ? { where: input.where } : {}),
                ...(input.update ? { update: input.update } : {}),
                ...(input.create ? { create: input.create } : {}),
                ...(input.ids ? { ids: input.ids } : {}),
                ...(input.cascade ? { cascade: 1 } : {}),
              });
              break;
            }
            case "countRecords": {
              const kind = input.kind?.trim();
              if (!kind) {
                return { ok: false as const, operation: op, projectId, error: "countRecords 需要 kind。" };
              }
              data = await countDynamicDbRecords({ projectId, kind, filter: input.where });
              break;
            }
            case "upsertRecord": {
              const kind = input.kind?.trim();
              if (!kind || !input.where || !input.create || !input.update) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: "upsertRecord 需要 kind、where、create、update。",
                };
              }
              data = await upsertDynamicDbRecord({
                projectId,
                kind,
                where: input.where,
                create: input.create,
                update: input.update,
              });
              break;
            }
            case "activateSchema": {
              const body = normalizeDynamicDbActivateBody(input.rootSchema);
              if (!body?.collections) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: formatDynamicDbSchemaValidationError("activateSchema", input.rootSchema),
                  hint: "新项目请先 setupSchema。",
                };
              }
              data = await activateDynamicDbSchema(projectId, body);
              break;
            }
            case "setupSchema": {
              const body = normalizeDynamicDbActivateBody(input.rootSchema);
              if (!body?.collections) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: formatDynamicDbSchemaValidationError("setupSchema", input.rootSchema),
                };
              }

              let needsInit = true;
              try {
                const current = await getDynamicDbProjectSchema(projectId);
                needsInit = schemaNeedsInitialize(current);
              } catch (e) {
                if (e instanceof DynamicDbApiError && (e.status === 404 || e.status === 409)) {
                  needsInit = true;
                } else if (e instanceof DynamicDbApiError) {
                  return {
                    ok: false as const,
                    operation: op,
                    projectId,
                    error: e.message,
                    errorCode:
                      typeof e.body === "object" && e.body !== null && "error_code" in e.body
                        ? String((e.body as { error_code: unknown }).error_code)
                        : undefined,
                    status: e.status,
                    data: e.body,
                  };
                } else {
                  throw e;
                }
              }

              if (needsInit) {
                data = await initializeDynamicDbProject(projectId, { root_schema: body });
                hint = "已执行 initializeProject。下一步: dynamicDb operation codegen";
              } else {
                data = await activateDynamicDbSchema(projectId, body);
                hint = "已执行 activateSchema。下一步: dynamicDb operation codegen";
              }
              break;
            }
            case "initializeProject": {
              const body = normalizeDynamicDbInitializeBody(input.rootSchema, input.initializeBody);
              if (!body) {
                return {
                  ok: false as const,
                  operation: op,
                  projectId,
                  error: formatDynamicDbSchemaValidationError(
                    "initializeProject",
                    input.rootSchema ?? input.initializeBody,
                  ),
                  hint: "优先 setupSchema + rootSchema.collections。",
                };
              }
              data = await initializeDynamicDbProject(projectId, body);
              break;
            }
            default:
              return { ok: false as const, operation: op, projectId, error: `未知 operation: ${op}` };
          }

          return { ok: true as const, operation: op, projectId, data, hint };
        } catch (e) {
          if (e instanceof DynamicDbApiError) {
            const errorCode =
              typeof e.body === "object" &&
              e.body !== null &&
              "error_code" in e.body &&
              typeof (e.body as { error_code: unknown }).error_code === "string"
                ? (e.body as { error_code: string }).error_code
                : undefined;
            return {
              ok: false as const,
              operation: op,
              projectId,
              error: e.message,
              errorCode,
              status: e.status,
              data: e.body,
            };
          }
          return {
            ok: false as const,
            operation: op,
            projectId,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
    }),
  };
}
