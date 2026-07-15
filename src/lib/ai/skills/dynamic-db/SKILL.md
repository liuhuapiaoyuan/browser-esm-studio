# Dynamic DB

## 适用场景

- 用户要持久化、CRUD、列表、表单数据、表/集合
- 用户要定义或迁移 Dynamic DB schema、生成类型、写入 seed/demo 数据

本技能由宿主在发送时加载，并依赖 Sandbox。所有数据库操作都必须通过 **`cli_execute` 调度 `ddb.*` 注册命令**（不是 HTTP，不是手写 fetch）。

---

## Role split（两层分工 — 强制）

| Layer | Who | How |
|-------|-----|-----|
| **Schema + seed + admin CRUD** | **You (Agent)** | **`cli_execute` + `ddb.*` only** |
| **Frontend / app business CRUD** | **User project code** | **`getDb()` from `src/lib/db.ts`** after **`ddb.codegen`** |

**Never** curl/fetch/wget Dynamic DB HTTP。**Never** 在用户项目里手写第二个 HTTP client。

**After schema + codegen succeed** → 信任 generated SDK；业务只接 **`getDb()`** — 不要用 `listRecords`「验证 API 通不通」。

---

## Meta-tool vs 注册命令（易错）

| 工具 | 用法 |
|------|------|
| `cli_search` | **直接调用** meta-tool，如 `{ "query": "schema setup" }` |
| `cli_describe` | **直接调用**，如 `{ "command": "ddb.setupSchema" }` |
| `cli_execute` | `{ "command": "ddb.setupSchema", "arguments": { ... } }` |
| `cli_diagnose` | **直接调用**，传入失败执行的 `executionId` |

**禁止**把 `cli_search` / `cli_describe` / `cli_diagnose` / `cli_execute` 当作 `cli_execute.command`。

**禁止**嵌套：`cli_execute({ command: "cli_execute", arguments: { command: "ddb.codegen" } })`。

`projectId` **由宿主自动绑定** — arguments 里**不要**传 `projectId`。

---

## 标准工作流

1. 不确定命令 → `cli_search`（如 `"schema setup"` / `"seed records"`）
2. 不确定参数 → `cli_describe`（`command: "ddb.setupSchema"`）
3. **已有项目改 schema** → 先 `ddb.getSchema`，把返回的 `json_schema.collections` **与新增集合合并**后再 `ddb.setupSchema`（只传新集合会覆盖掉旧集合）
4. **`ddb.setupSchema`** → 看返回 `hint` / `path`
5. **立刻 `ddb.codegen`**
6. **`sandbox.readFile`** `src/ddb/generated/index.ts`，确认 **`kindNames`** 与 **`GeneratedDb` 上的 delegate 键名**
7. 可选 seed → `ddb.createRecord` / `ddb.recordsBatch`
8. 在用户项目写 UI / 业务 CRUD → **`getDb()`**；改完跑 `sandbox.typecheck`

---

## Schema — 优先 `ddb.setupSchema`

`rootSchema` 必须是**嵌套 JSON 对象**，放在 `arguments.rootSchema` 里 — **不要 stringify**，不要包 `{ root_schema: ... }`（initialize 时宿主会自动包）。

### 正确示例（canonical）

```json
{
  "command": "ddb.setupSchema",
  "arguments": {
    "rootSchema": {
      "collections": {
        "students": {
          "type": "object",
          "properties": {
            "name": { "type": "string", "title": "姓名" },
            "studentNo": { "type": "string", "title": "学号" }
          },
          "required": ["name", "studentNo"]
        }
      }
    }
  }
}
```

### 常见错误对照

| 错误写法 | 问题 |
|----------|------|
| `"rootSchema": "{\"collections\":...}"` | stringify 了；应传对象 |
| `{ "students": { "type": "object", ... } }` 缺 `collections` | 宿主可自动包一层，但**优先显式写 `collections`** |
| `{ "root_schema": { "collections": ... } }` | setupSchema 不需要外层 `root_schema` |
| `arguments` 里带 `projectId` | 宿主已绑定，多余且易错 |
| 只传新增集合、未合并旧 schema | **会覆盖**已有 collections |

### Schema 规则

- kind 名：**小写复数**，如 `students`、`daily-records`
- 每个 kind 必须是 JSON Schema object：`type: "object"` + `properties` + `required`
- 成功后看 **`hint`** → 立刻 **`ddb.codegen`**

| 情况 | command |
|------|---------|
| 默认 / 新功能 | **ddb.setupSchema** |
| 已 initialize，明确只 activate | ddb.activateSchema |
| 明确从未 initialize | ddb.initializeProject（少用；优先 setupSchema） |

### kind 名 vs delegate 键名（含连字符）

`codegen` 后读 `src/ddb/generated/index.ts`：

- `kindNames` 里是 API/CLI 用的 kind：`['students', 'daily-records']`
- `GeneratedDb` 上 delegate 键名会把非法字符换成 `_`：`students`、`_daily_records`

| 场景 | students | daily-records |
|------|----------|---------------|
| Agent CLI `kind` | `"students"` | `"daily-records"` |
| `getDb()` 访问 | `db.students` | `db._daily_records` |

**CLI 的 `kind` 永远用 kindNames 原串**；**业务代码用 GeneratedDb 上的键名**。

---

## Codegen

```json
{
  "command": "ddb.codegen",
  "arguments": {}
}
```

写入 `src/ddb/generated/*`。导出 ZIP 后用户可在本机 `pnpm ddb:codegen`。

---

## Seed / admin 记录（Agent 侧）

用于 **seed/demo** 或管理侧；应用业务 CRUD 必须写在用户项目里通过 **`getDb()`**。

### `ddb.createRecord`

字段在 **`payload`** 里（不是 `data`）：

```json
{
  "command": "ddb.createRecord",
  "arguments": {
    "kind": "students",
    "payload": { "name": "张三", "studentNo": "2024001" }
  }
}
```

### `ddb.recordsBatch`

`batchOperation` 枚举值必须精确匹配（不是 `operation`）：

```json
{
  "command": "ddb.recordsBatch",
  "arguments": {
    "kind": "students",
    "batchOperation": "recordsBatchCreate",
    "data": [
      { "name": "张三", "studentNo": "2024001" },
      { "name": "李四", "studentNo": "2024002" }
    ]
  }
}
```

`batchOperation` 可选：`recordsBatchCreate` | `recordsBatchUpdate` | `recordsBatchDelete` | `recordsUpsert`。

### `ddb.listRecords`

```json
{
  "command": "ddb.listRecords",
  "arguments": {
    "kind": "students",
    "page": 1,
    "pageSize": 20,
    "where": { "name": "张三" }
  }
}
```

- 过滤字段叫 **`where`**（不是 `filter`）
- `page` / `pageSize` 用 JSON number（`20`，不是 `"20"`）

### 其他记录命令（速查）

| 命令 | 关键参数 |
|------|----------|
| `ddb.getRecord` | `kind`, `recordId` |
| `ddb.updateRecord` | `kind`, `recordId`, `payload`（部分字段） |
| `ddb.deleteRecord` | `kind`, `recordId`；可选 `cascade` |
| `ddb.upsertRecord` | `kind`, `where`, `create`, `update` |
| `ddb.countRecords` | `kind`；可选 `where` |
| `ddb.getSchema` | `{}` |
| `ddb.getEffectiveSchema` | `kind` |

---

## App 用法（codegen 之后）

从 `src/App.tsx` 或 `src/components/*.tsx`：

```typescript
import { getDb, isDdbConfigured } from "./lib/db.ts";
import type { StudentsRecord } from "./ddb/generated/index.ts";

if (!isDdbConfigured()) {
  /* 空状态 */
}

const db = getDb();

// 列表：返回 RecordEnvelope，业务字段在 payload
const { items = [] } = await db.students.findMany({ page: 1, pageSize: 50 });
items.map((row: StudentsRecord) => row.payload.name);

// 写入：直接传 payload 字段，不要再包一层 payload
await db.students.create({ name: "张三", studentNo: "2024001" });
await db.students.update({ id: row.id, data: { name: "李四" } });
await db.students.delete({ id: row.id });

// 连字符 kind：CLI 用 "daily-records"，代码用 db._daily_records
await db._daily_records.create({ note: "今日学习记录" });
```

要点：

- **读**：`row.payload.xxx`
- **写 create**：扁平字段 `{ name, studentNo }`
- **写 update**：`{ id, data: { ...partial } }`
- **不要** curl/fetch；**不要**用 `listRecords` 验证 API
- **仍可用** `createRecord` / `recordsBatch` 写 **seed/demo 内容**（不是连通性测试）

---

## 失败恢复

1. `cli_diagnose`（`executionId`）
2. `INVALID_ARGUMENT` + schema → 检查 `rootSchema.collections` 结构
3. `RESOURCE_NOT_FOUND` + records → `ddb.getSchema` 确认 kind 拼写
4. schema 变更后忘记 codegen → 补跑 `ddb.codegen` 并 `sandbox.typecheck`
