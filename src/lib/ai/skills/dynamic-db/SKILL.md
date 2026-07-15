# Dynamic DB

## 何时 load

- 用户要持久化、CRUD、列表、表单数据、表/集合
- 消息含 `/skill dynamic-db`

## Role split（两层分工 — 强制）

| Layer | Who | How |
|-------|-----|-----|
| **Schema + seed + admin CRUD** | **You (Agent)** | **`cli_execute` + `ddb.*` commands only** |
| **Frontend / app business CRUD** | **User project code** | **`getDb()` from `src/lib/db.ts`** after **`ddb.codegen`** |

**Never** curl/fetch/wget against Dynamic DB HTTP. **Never** hand-write a second HTTP client in the user project.

**After schema + codegen succeed** → trust the generated SDK; wire **`getDb()`** only — do not smoke-test REST.

---

## Agent CLI 调度

1. 不确定命令名 → `cli_search`（如 query: `"schema setup"`）
2. 不确定参数 → `cli_describe`（command: `ddb.setupSchema`）
3. 执行 → `cli_execute`（command + JSON arguments）
4. 失败 → `cli_diagnose`（executionId）按结构化 recovery 处理

**`projectId` is auto-bound** — do **not** pass `projectId` in arguments.
Schema ops use **`rootSchema` as a nested JSON object** — never stringify.

---

## Schema — 优先 `ddb.setupSchema`

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

- kind 名 **小写复数**：`students`
- 成功后看 **`hint`** → 立刻 **`cli_execute` `ddb.codegen`**
- 然后 **`cli_execute` `sandbox.readFile`** `src/ddb/generated/index.ts` 看 **`kindNames`**（含连字符 kind 可能是 `db._daily_records`）

| 情况 | command |
|------|---------|
| 默认 / 新功能 | **ddb.setupSchema** |
| 已 initialize，只改 Schema | ddb.activateSchema |
| 明确从未 initialize | ddb.initializeProject（少用） |

---

## Codegen（本工作室）

```json
{
  "command": "ddb.codegen",
  "arguments": {}
}
```

宿主会拉取 schema，写入 `src/ddb/generated/*`。导出 ZIP 后用户可在本机用官方 CLI。

---

## Seed / admin 记录

- `ddb.createRecord` / `ddb.recordsBatch` / `ddb.listRecords` 等用于 **seed/demo** 或管理侧
- 应用业务 CRUD 必须写在用户项目里，通过 **`getDb()`**

---

## App 用法

```typescript
import { getDb, isDdbConfigured } from "./lib/db.ts";
import type { StudentsRecord } from "../ddb/generated/index.ts";

if (!isDdbConfigured()) { /* 空状态 */ }
const db = getDb();
const { items = [] } = await db.students.findMany({ page: 1, pageSize: 50 });
// 业务字段在 record.payload
items.map((row: StudentsRecord) => row.payload.name);

await db.students.create({ name: "张三", studentNo: "2024001" });
await db.students.update({ id: row.id, data: { name: "李四" } });
```

**Forbidden post-codegen:** curl、手写 fetch、用 listRecords「验证 API 通不通」。
**Still OK:** createRecord / recordsBatch 做 **seed/demo 数据**（内容，不是验证）。
