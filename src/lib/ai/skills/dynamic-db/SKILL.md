# Dynamic DB

## 何时 load

- 用户要持久化、CRUD、列表、表单数据、表/集合
- 消息含 `/skill dynamic-db`

## Role split（两层分工 — 强制）

| Layer | Who | How |
|-------|-----|-----|
| **Schema + seed + admin CRUD** | **You (Agent)** | **`dynamicDb` tool only** |
| **Frontend / app business CRUD** | **User project code** | **`getDb()` from `src/lib/db.ts`** after **`dynamicDb` / `codegen`** |

**Never** curl/fetch/wget against Dynamic DB HTTP. **Never** hand-write a second HTTP client in the user project.

**After schema + codegen succeed** → trust the generated SDK; wire **`getDb()`** only — do not smoke-test REST.

---

## Tool rules

- **`projectId` is auto-bound** from the studio workspace — do **not** pass `projectId` in tool args.
- Schema ops use **`rootSchema` as a nested JSON object** — never stringify.

---

## Schema — 优先 `setupSchema`

```json
{
  "operation": "setupSchema",
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
```

- kind 名 **小写复数**：`students`
- 成功后看 **`hint`** → 立刻 **`operation: codegen`**
- 然后 **`readFile` `src/ddb/generated/index.ts`** 看 **`kindNames`**（含连字符 kind 可能是 `db._daily_records`）

| 情况 | operation |
|------|-----------|
| 默认 / 新功能 | **setupSchema** |
| 已 initialize，只改 Schema | activateSchema |
| 明确从未 initialize | initializeProject（少用） |

---

## Codegen（本工作室）

用：

```json
{ "operation": "codegen" }
```

宿主会拉取 schema，写入 `src/ddb/generated/*`。导出 ZIP 后用户可在本机用官方 CLI。

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
