import { z } from "zod";
import {
  activateDynamicDbSchema,
  DynamicDbApiError,
  getDynamicDbEffectiveSchema,
  getDynamicDbInventory,
  getDynamicDbProjectSchema,
  initializeDynamicDbProject,
} from "../../../../../database/dynamic-db-api";
import {
  formatDynamicDbSchemaValidationError,
  normalizeDynamicDbActivateBody,
  normalizeDynamicDbInitializeBody,
  schemaNeedsInitialize,
} from "../../../../../database/dynamic-db-schema-normalize";
import { codegenDdbProjectFiles } from "../../../../../database/codegen";
import { defineCommand } from "../../../define-command";
import { AgentCliCommandError } from "../../../protocol";
import { applyGeneratedFiles, mapDynamicDbError, resolveProjectId } from "../shared";

const rootSchemaInput = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .describe(
    "Schema body: { collections: { students: { type, properties, required } } } — prefer nested object, not stringified JSON",
  );

export const ddbGetSchema = defineCommand({
  metadata: {
    name: "ddb.getSchema",
    version: "1.0.0",
    title: "读取项目 Schema",
    summary: "获取当前绑定 Dynamic DB 项目的 root schema",
    tags: ["ddb", "schema", "read"],
  },
  agent: {
    purpose: "查看当前项目已声明的集合与字段结构",
    useWhen: ["需要了解现有 schema", "setupSchema 前确认是否已 initialize"],
    avoidWhen: ["需要改写 schema（用 ddb.setupSchema）"],
    examples: [{ userRequest: "看看现在数据库有哪些集合", input: {} }],
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    projectId: z.string(),
    data: z.unknown(),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(_input) {
    try {
      const projectId = await resolveProjectId();
      const data = await getDynamicDbProjectSchema(projectId);
      return { projectId, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbGetEffectiveSchema = defineCommand({
  metadata: {
    name: "ddb.getEffectiveSchema",
    version: "1.0.0",
    title: "读取集合生效 Schema",
    summary: "按 kind 读取某个集合的 effective schema",
    tags: ["ddb", "schema", "read"],
  },
  agent: {
    purpose: "查看单个 collection kind 的生效字段定义",
    useWhen: ["需要确认某个 kind 的字段", "排查字段校验失败"],
    avoidWhen: ["需要列出全部集合（用 ddb.getSchema）"],
    examples: [
      {
        userRequest: "students 集合字段是什么",
        input: { kind: "students" },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1).describe("Collection kind，如 students"),
  }),
  outputSchema: z.object({
    projectId: z.string(),
    kind: z.string(),
    data: z.unknown(),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await getDynamicDbEffectiveSchema(projectId, kind);
      return { projectId, kind, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbGetInventory = defineCommand({
  metadata: {
    name: "ddb.getInventory",
    version: "1.0.0",
    title: "读取 Dynamic DB 库存",
    summary: "获取当前账号可见的 Dynamic DB inventory",
    tags: ["ddb", "inventory", "read"],
  },
  agent: {
    purpose: "查看账号侧 inventory / 可用资源概览",
    useWhen: ["排查绑定或账号侧资源"],
    avoidWhen: ["读写当前项目业务记录"],
    examples: [{ userRequest: "看看 Dynamic DB inventory", input: {} }],
  },
  inputSchema: z.object({}),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute() {
    try {
      const projectId = await resolveProjectId();
      const data = await getDynamicDbInventory();
      return { projectId, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbSetupSchema = defineCommand({
  metadata: {
    name: "ddb.setupSchema",
    version: "1.0.0",
    title: "配置 Schema（推荐）",
    summary: "新项目 initialize 或已有项目 activateSchema；自动选择路径",
    tags: ["ddb", "schema", "write"],
  },
  agent: {
    purpose: "声明或更新 rootSchema.collections，是持久化功能的第一步",
    useWhen: [
      "用户要持久化 / CRUD / 表单数据",
      "需要新建或修改集合字段",
    ],
    avoidWhen: ["只读现有数据（用 ddb.listRecords）", "schema 已就绪只需 codegen"],
    instructions: [
      "rootSchema 用嵌套 JSON 对象，不要 stringify",
      "kind 名用小写复数，如 students",
      "成功后立刻 cli_execute ddb.codegen",
      "然后 readFile src/ddb/generated/index.ts 查看 kindNames",
      "业务代码只用 getDb()，不要 curl/fetch",
    ],
    examples: [
      {
        userRequest: "给学生做一个可持久化的列表",
        input: {
          rootSchema: {
            collections: {
              students: {
                type: "object",
                properties: {
                  name: { type: "string", title: "姓名" },
                  studentNo: { type: "string", title: "学号" },
                },
                required: ["name", "studentNo"],
              },
            },
          },
        },
      },
    ],
  },
  inputSchema: z.object({
    rootSchema: rootSchemaInput,
  }),
  outputSchema: z.object({
    projectId: z.string(),
    data: z.unknown(),
    hint: z.string(),
    path: z.enum(["initializeProject", "activateSchema"]),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  recovery: {
    maxAutoRetries: 1,
    errors: {
      INVALID_ARGUMENT: {
        description: "rootSchema 缺少 collections",
        retryable: true,
        suggestions: ["提供 rootSchema.collections 对象后重试"],
      },
    },
  },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const body = normalizeDynamicDbActivateBody(input.rootSchema);
      if (!body?.collections) {
        throw new AgentCliCommandError(
          "INVALID_ARGUMENT",
          formatDynamicDbSchemaValidationError("setupSchema", input.rootSchema),
          { retryable: true, field: "/rootSchema" },
        );
      }

      let needsInit = true;
      try {
        const current = await getDynamicDbProjectSchema(projectId);
        needsInit = schemaNeedsInitialize(current);
      } catch (e) {
        if (e instanceof DynamicDbApiError && (e.status === 404 || e.status === 409)) {
          needsInit = true;
        } else {
          mapDynamicDbError(e);
        }
      }

      if (needsInit) {
        const data = await initializeDynamicDbProject(projectId, { root_schema: body });
        return {
          projectId,
          data,
          path: "initializeProject" as const,
          hint: "已执行 initializeProject。下一步: cli_execute ddb.codegen",
        };
      }
      const data = await activateDynamicDbSchema(projectId, body);
      return {
        projectId,
        data,
        path: "activateSchema" as const,
        hint: "已执行 activateSchema。下一步: cli_execute ddb.codegen",
      };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbActivateSchema = defineCommand({
  metadata: {
    name: "ddb.activateSchema",
    version: "1.0.0",
    title: "激活 Schema",
    summary: "在已 initialize 的项目上 activateSchema",
    tags: ["ddb", "schema", "write"],
  },
  agent: {
    purpose: "已 initialize 后仅更新 schema",
    useWhen: ["明确项目已 initialize，只需改 schema"],
    avoidWhen: ["新项目（优先 ddb.setupSchema）"],
    instructions: ["成功后执行 ddb.codegen"],
    examples: [
      {
        userRequest: "给已有项目加一个 courses 集合",
        input: {
          rootSchema: {
            collections: {
              courses: {
                type: "object",
                properties: { title: { type: "string" } },
                required: ["title"],
              },
            },
          },
        },
      },
    ],
  },
  inputSchema: z.object({ rootSchema: rootSchemaInput }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const body = normalizeDynamicDbActivateBody(input.rootSchema);
      if (!body?.collections) {
        throw new AgentCliCommandError(
          "INVALID_ARGUMENT",
          formatDynamicDbSchemaValidationError("activateSchema", input.rootSchema),
          {
            retryable: true,
            field: "/rootSchema",
            suggestions: ["新项目请先 ddb.setupSchema"],
          },
        );
      }
      const data = await activateDynamicDbSchema(projectId, body);
      return {
        projectId,
        data,
        hint: "下一步: cli_execute ddb.codegen",
      };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbInitializeProject = defineCommand({
  metadata: {
    name: "ddb.initializeProject",
    version: "1.0.0",
    title: "初始化项目",
    summary: "显式 initialize Dynamic DB 项目（少用；优先 setupSchema）",
    tags: ["ddb", "schema", "write"],
  },
  agent: {
    purpose: "明确从未 initialize 时初始化项目",
    useWhen: ["明确需要 initializeProject"],
    avoidWhen: ["默认情况（用 ddb.setupSchema）"],
    instructions: ["优先使用 ddb.setupSchema"],
    examples: [
      {
        userRequest: "强制 initialize 项目 schema",
        input: {
          rootSchema: {
            collections: {
              notes: {
                type: "object",
                properties: { body: { type: "string" } },
                required: ["body"],
              },
            },
          },
        },
      },
    ],
  },
  inputSchema: z.object({
    rootSchema: rootSchemaInput.optional(),
    initializeBody: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .describe("可选原始 initialize body"),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const body = normalizeDynamicDbInitializeBody(input.rootSchema, input.initializeBody);
      if (!body) {
        throw new AgentCliCommandError(
          "INVALID_ARGUMENT",
          formatDynamicDbSchemaValidationError(
            "initializeProject",
            input.rootSchema ?? input.initializeBody,
          ),
          {
            retryable: true,
            suggestions: ["优先 setupSchema + rootSchema.collections"],
          },
        );
      }
      const data = await initializeDynamicDbProject(projectId, body);
      return { projectId, data, hint: "下一步: cli_execute ddb.codegen" };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbCodegen = defineCommand({
  metadata: {
    name: "ddb.codegen",
    version: "1.0.0",
    title: "生成前端 SDK",
    summary: "拉取 schema 并写入 src/ddb/generated/*，供 getDb() 使用",
    tags: ["ddb", "codegen", "write"],
  },
  agent: {
    purpose: "schema 就绪后生成类型与客户端，业务代码通过 getDb() 访问",
    useWhen: ["setupSchema / activateSchema 成功之后", "schema 变更后需要刷新生成物"],
    avoidWhen: ["尚未配置 schema"],
    instructions: [
      "成功后 readFile src/ddb/generated/index.ts 查看 kindNames",
      "业务 CRUD 只用 getDb()，不要用 listRecords 验证 API",
      "seed/demo 数据仍可用 ddb.createRecord / ddb.recordsBatch",
    ],
    examples: [{ userRequest: "生成数据库客户端代码", input: {} }],
  },
  inputSchema: z.object({}),
  outputSchema: z.object({
    projectId: z.string(),
    kindNames: z.unknown(),
    schemaVersion: z.unknown(),
    changed: z.array(z.string()),
    hint: z.string(),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: true, confirmation: "on-write" },
  async execute(_input, ctx) {
    try {
      const projectId = await resolveProjectId();
      const result = await codegenDdbProjectFiles(projectId);
      const changed = applyGeneratedFiles(ctx.sandbox, result.files);
      return {
        projectId,
        kindNames: result.kindNames,
        schemaVersion: result.schemaVersion,
        changed,
        hint: "已写入 src/ddb/generated。请 Read kindNames，业务代码只用 getDb()。",
      };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});
