import { z } from "zod";
import {
  countDynamicDbRecords,
  createDynamicDbRecord,
  deleteDynamicDbRecord,
  dynamicDbRecordsBatch,
  getDynamicDbRecord,
  listDynamicDbRecords,
  updateDynamicDbRecord,
  upsertDynamicDbRecord,
} from "../../../../../database/dynamic-db-api";
import { defineCommand } from "../../../define-command";
import { mapDynamicDbError, resolveProjectId } from "../shared";

const populateSchema = z.union([z.boolean(), z.array(z.string())]).optional();

export const ddbListRecords = defineCommand({
  metadata: {
    name: "ddb.listRecords",
    version: "1.0.0",
    title: "列出记录",
    summary: "分页列出指定 kind 的记录（Agent 侧 admin/seed，非业务前端）",
    tags: ["ddb", "records", "read"],
  },
  agent: {
    purpose: "Agent 管理侧读取集合记录；应用业务请用 getDb()",
    useWhen: ["需要 seed 前查看数据", "排查记录内容"],
    avoidWhen: ["验证 API 是否通畅（codegen 后应用 getDb）", "在用户项目里代替 getDb"],
    examples: [
      {
        userRequest: "列出 students 前 20 条",
        input: { kind: "students", page: 1, pageSize: 20 },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1).describe("Collection kind"),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(50).optional(),
    where: z.record(z.string(), z.unknown()).optional().describe("过滤条件"),
    populate: populateSchema,
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  recovery: {
    maxAutoRetries: 1,
    errors: {
      RESOURCE_NOT_FOUND: {
        description: "kind 或项目不存在",
        retryable: true,
        suggestions: ["调用 ddb.getSchema 确认集合名", "必要时先 ddb.setupSchema"],
      },
    },
  },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await listDynamicDbRecords({
        projectId,
        kind,
        page: input.page,
        pageSize: input.pageSize,
        filter: input.where,
        populate: input.populate,
      });
      return { projectId, kind, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbGetRecord = defineCommand({
  metadata: {
    name: "ddb.getRecord",
    version: "1.0.0",
    title: "读取单条记录",
    summary: "按 kind + recordId 读取一条记录",
    tags: ["ddb", "records", "read"],
  },
  agent: {
    purpose: "读取单条记录详情",
    useWhen: ["已知 recordId 需要详情"],
    avoidWhen: ["列表浏览（用 ddb.listRecords）"],
    examples: [
      {
        userRequest: "看一下这条学生记录",
        input: { kind: "students", recordId: "rec_1" },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    recordId: z.string().min(1),
    populate: z.boolean().optional(),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const recordId = input.recordId.trim();
      const data = await getDynamicDbRecord({
        projectId,
        kind,
        recordId,
        populate: input.populate === true,
      });
      return { projectId, kind, recordId, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbCountRecords = defineCommand({
  metadata: {
    name: "ddb.countRecords",
    version: "1.0.0",
    title: "统计记录数",
    summary: "统计指定 kind 的记录数量",
    tags: ["ddb", "records", "read"],
  },
  agent: {
    purpose: "统计集合记录数",
    useWhen: ["需要知道有多少条数据"],
    avoidWhen: ["需要完整列表内容"],
    examples: [{ userRequest: "students 有多少条", input: { kind: "students" } }],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    where: z.record(z.string(), z.unknown()).optional(),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await countDynamicDbRecords({
        projectId,
        kind,
        filter: input.where,
      });
      return { projectId, kind, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbCreateRecord = defineCommand({
  metadata: {
    name: "ddb.createRecord",
    version: "1.0.0",
    title: "创建记录",
    summary: "创建一条记录（适合 seed/demo；业务代码用 getDb()）",
    tags: ["ddb", "records", "write"],
  },
  agent: {
    purpose: "Agent 侧 seed/demo 写入",
    useWhen: ["写入演示数据", "管理侧创建记录"],
    avoidWhen: ["应用业务 CRUD（应写 getDb() 代码）"],
    examples: [
      {
        userRequest: "插入一条学生演示数据",
        input: { kind: "students", payload: { name: "张三", studentNo: "2024001" } },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    payload: z.record(z.string(), z.unknown()).describe("记录字段 payload"),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await createDynamicDbRecord({
        projectId,
        kind,
        payload: input.payload,
      });
      return { projectId, kind, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbUpdateRecord = defineCommand({
  metadata: {
    name: "ddb.updateRecord",
    version: "1.0.0",
    title: "更新记录",
    summary: "按 recordId 更新一条记录",
    tags: ["ddb", "records", "write"],
  },
  agent: {
    purpose: "更新已有记录",
    useWhen: ["管理侧修正一条记录"],
    avoidWhen: ["应用内业务更新（用 getDb）"],
    examples: [
      {
        userRequest: "把学生名字改成李四",
        input: {
          kind: "students",
          recordId: "rec_1",
          payload: { name: "李四" },
        },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    recordId: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: true, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const recordId = input.recordId.trim();
      const data = await updateDynamicDbRecord({
        projectId,
        kind,
        recordId,
        payload: input.payload,
      });
      return { projectId, kind, recordId, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbDeleteRecord = defineCommand({
  metadata: {
    name: "ddb.deleteRecord",
    version: "1.0.0",
    title: "删除记录",
    summary: "删除一条记录，可选 cascade",
    tags: ["ddb", "records", "destructive"],
  },
  agent: {
    purpose: "删除记录",
    useWhen: ["清理 demo/seed 数据"],
    avoidWhen: ["误删生产关键数据（需用户确认）"],
    examples: [
      {
        userRequest: "删掉这条学生记录",
        input: { kind: "students", recordId: "rec_1" },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    recordId: z.string().min(1),
    cascade: z.boolean().optional(),
  }),
  safety: {
    risk: "destructive",
    sideEffect: true,
    idempotent: true,
    confirmation: "always",
  },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const recordId = input.recordId.trim();
      const data = await deleteDynamicDbRecord({
        projectId,
        kind,
        recordId,
        cascade: input.cascade,
      });
      return { projectId, kind, recordId, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbUpsertRecord = defineCommand({
  metadata: {
    name: "ddb.upsertRecord",
    version: "1.0.0",
    title: "Upsert 记录",
    summary: "按 where 条件 upsert 一条记录",
    tags: ["ddb", "records", "write"],
  },
  agent: {
    purpose: "按条件创建或更新记录（seed 幂等写入）",
    useWhen: ["需要幂等 seed"],
    avoidWhen: ["简单创建（用 ddb.createRecord）"],
    examples: [
      {
        userRequest: "按学号 upsert 学生",
        input: {
          kind: "students",
          where: { studentNo: "2024001" },
          create: { name: "张三", studentNo: "2024001" },
          update: { name: "张三" },
        },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    where: z.record(z.string(), z.unknown()),
    create: z.record(z.string(), z.unknown()),
    update: z.record(z.string(), z.unknown()),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: true, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await upsertDynamicDbRecord({
        projectId,
        kind,
        where: input.where,
        create: input.create,
        update: input.update,
      });
      return { projectId, kind, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});

export const ddbRecordsBatch = defineCommand({
  metadata: {
    name: "ddb.recordsBatch",
    version: "1.0.0",
    title: "批量记录操作",
    summary: "批量 create/update/delete/upsert 记录",
    tags: ["ddb", "records", "write", "batch"],
  },
  agent: {
    purpose: "批量 seed 或批量管理侧变更",
    useWhen: ["一次写入多条 demo 数据"],
    avoidWhen: ["单条操作（用对应单命令）"],
    examples: [
      {
        userRequest: "批量插入两名学生",
        input: {
          kind: "students",
          batchOperation: "recordsBatchCreate",
          data: [
            { name: "张三", studentNo: "1" },
            { name: "李四", studentNo: "2" },
          ],
        },
      },
    ],
  },
  inputSchema: z.object({
    kind: z.string().min(1),
    batchOperation: z.enum([
      "recordsBatchCreate",
      "recordsBatchUpdate",
      "recordsBatchDelete",
      "recordsUpsert",
    ]),
    data: z.array(z.record(z.string(), z.unknown())).optional(),
    where: z.record(z.string(), z.unknown()).optional(),
    update: z.record(z.string(), z.unknown()).optional(),
    create: z.record(z.string(), z.unknown()).optional(),
    ids: z.array(z.string()).optional(),
    cascade: z.boolean().optional(),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input) {
    try {
      const projectId = await resolveProjectId();
      const kind = input.kind.trim();
      const data = await dynamicDbRecordsBatch({
        operation: input.batchOperation,
        projectId,
        kind,
        ...(input.data ? { data: input.data } : {}),
        ...(input.where ? { where: input.where } : {}),
        ...(input.update ? { update: input.update } : {}),
        ...(input.create ? { create: input.create } : {}),
        ...(input.ids ? { ids: input.ids } : {}),
        ...(input.cascade ? { cascade: 1 } : {}),
      });
      return { projectId, kind, batchOperation: input.batchOperation, data };
    } catch (e) {
      mapDynamicDbError(e);
    }
  },
});
