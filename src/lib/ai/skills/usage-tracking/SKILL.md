# Usage Tracking（学情追踪）

## 适用场景

- 老师要在**已有或新建课件页**注入「学生使用情况」追踪
- 需要：学生入场署名、口令校验、停留/互动记录、老师入口查看学情
- 典型需求：「谁打开过这页」「用了多久」「答到哪一关」

本技能是 **playbook**（无独立 CLI 命令）。依赖已加载的 **Sandbox** 与 **Dynamic DB**。

**Never** 在口令未确认前改文件 / 建 schema / 写追踪代码。  
**Never** 用手写 fetch / curl 写 Dynamic DB；业务一律 `getDb()`（见 `dynamic-db` skill）。  
**Never** 把口令写进聊天回复给「学生可见文案」；口令只进配置源 `src/content/usage-tracking.json`。

若本 skill 未加载而用户明确要「追踪学生使用 / 老师看学情」，告知启用 `usage-tracking`，不要假装已注入。

---

## 硬门禁（开工前必须满足 — 强制）

在调用任何 `sandbox.*` / `ddb.*` **之前**，必须同时具备：

| 字段 | 说明 | 缺省 |
|------|------|------|
| `studentPasscode` | 学生入场口令 | **无缺省** — 老师没说就**必须反问**：「学生入场口令是什么？」 |
| `teacherPasscode` | 老师入口口令 | **无缺省** — 没说就**必须反问**：「老师查看学情的口令是什么？」 |
| `trackEvents` | 要记哪些事件 | 见下方默认事件集 |
| `displayName` | 课件显示名（学情列表标题） | 从页面标题 / 用户原话推断 |

### 反问规则（写死）

1. 老师只说「帮我加追踪」但**没给口令** → **只反问，不改代码**。
2. 只给了一个口令、未说明用途 → 反问：是学生口令、老师口令，还是两者共用？
3. 老师明确说「学生和老师用同一个口令」→ 允许 `studentPasscode === teacherPasscode`，仍须把两个字段都写进配置。
4. 口令确认后才能进入「强制流水线」。信息足够则直接执行，不要反复追问已确认项。

---

## 产品规格（权威）

### 双入口

```
学生：打开课件 → 入场门（姓名 + 学生口令）→ 通过后进入原课件 → 后台记事件
老师：隐蔽入口 → 老师口令 → 学情面板（名单 / 时长 / 事件）
```

| 角色 | 必填 | 通过后 |
|------|------|--------|
| 学生 | 姓名（非空 trim）+ `studentPasscode` | 写入/更新 session，放行主界面 |
| 老师 | 仅 `teacherPasscode`（不要姓名） | 打开学情面板，**不**冒充学生 session |

### 学生入场门（UI）

- 全屏遮罩，挡住主课件；未通过前**不可**操作正文
- 字段：姓名（text）、口令（password）、「开始学习」按钮
- 口令错误：就地提示，不放行
- 通过后：session 存 `sessionStorage`（键名固定 `usage-tracking:session`），本标签页刷新可免登；关标签需重登
- 视觉：跟随现有课件色板，简洁表单，**不要**另起一套儿童闯关皮肤

### 老师入口（UI）

- **必须提供**隐蔽入口，默认实现（可并存）：
  1. 主界面角落小按钮（如「师」字 / 齿轮），`aria-label="老师入口"`
  2. URL 查询参数 `?teacher=1` 时自动弹出老师口令框
- 口令正确 → 学情面板；错误 → 就地提示
- 学情面板至少展示：
  - 学生姓名列表（按最近活跃倒序）
  - 首次进入时间、最近活跃、累计停留（秒→可读）
  - 事件摘要（可选展开：时间 + 事件类型 + 简述）
- 提供「刷新」；数据来自 Dynamic DB，不是假数据

### 默认追踪事件

用户未指定时，至少实现：

| `type` | 何时写 |
|--------|--------|
| `enter` | 学生口令通过，创建/恢复 session |
| `heartbeat` | 每 60s（页面可见时）更新 `lastActiveAt` 与 `durationSec` |
| `leave` | `visibilitychange` hidden / `pagehide` 时 flush 一次 |
| `interact` | 课件关键操作（答题、翻关、打开弹窗等）— 在既有 handler 里打点 |

`interact` 的 `label` 用短中文（如「完成第3关」），不要塞大段 DOM。

---

## 配置真相源

固定路径：`src/content/usage-tracking.json`

```json
{
  "displayName": "单元课件",
  "studentPasscode": "CLASS2026",
  "teacherPasscode": "TEACH2026",
  "trackEvents": ["enter", "heartbeat", "leave", "interact"],
  "heartbeatSec": 60
}
```

- 口令以老师确认为准，**原样写入**该文件（课堂共享口令场景；勿在 UI 明文回显）
- 改口令 = 改此文件 + 保持校验逻辑读配置，不要散落魔法字符串

---

## Dynamic DB schema（强制）

依赖 `dynamic-db`。**已有项目**先 `ddb.getSchema`，把下列集合**合并**进已有 `collections` 再 `ddb.setupSchema`，禁止只传新集合覆盖旧表。

```json
{
  "collections": {
    "usage-sessions": {
      "type": "object",
      "properties": {
        "studentName": { "type": "string", "title": "姓名" },
        "enteredAt": { "type": "string", "title": "首次进入" },
        "lastActiveAt": { "type": "string", "title": "最近活跃" },
        "durationSec": { "type": "number", "title": "累计秒" },
        "eventCount": { "type": "number", "title": "事件数" }
      },
      "required": ["studentName", "enteredAt", "lastActiveAt", "durationSec"]
    },
    "usage-events": {
      "type": "object",
      "properties": {
        "sessionId": { "type": "string", "title": "会话ID" },
        "studentName": { "type": "string", "title": "姓名" },
        "type": { "type": "string", "title": "事件类型" },
        "label": { "type": "string", "title": "简述" },
        "at": { "type": "string", "title": "时间" }
      },
      "required": ["sessionId", "studentName", "type", "at"]
    }
  }
}
```

顺序：`ddb.setupSchema` → `ddb.codegen` → `sandbox.readFile` `src/ddb/generated/index.ts` 确认 delegate：

| kind（CLI） | 代码访问 |
|-------------|----------|
| `usage-sessions` | `db._usage_sessions` |
| `usage-events` | `db._usage_events` |

业务读写规则与 `dynamic-db` 一致：读 `row.payload.xxx`；create 传扁平字段。

---

## 模块落点（推荐结构）

| 路径 | 职责 |
|------|------|
| `src/content/usage-tracking.json` | 口令与开关 |
| `src/lib/usage-tracking.ts` | 校验口令、session、打点、heartbeat |
| `src/components/StudentGate.tsx` | 学生入场门 |
| `src/components/TeacherPortal.tsx` | 老师口令 + 学情面板 |
| `src/App.tsx`（或根组件） | 包裹：未入场→Gate；已入场→课件 + 老师入口 |

### `src/lib/usage-tracking.ts` 契约

导出至少：

```typescript
checkStudentPasscode(input: string): boolean
checkTeacherPasscode(input: string): boolean
ensureStudentSession(studentName: string): Promise<{ sessionId: string }>
track(type: string, label?: string): Promise<void>
startHeartbeat(): () => void  // 返回 stop
listSessionsForTeacher(): Promise<Array<{ id: string; payload: ... }>>
listEventsForSession(sessionId: string): Promise<...>
```

实现要点：

- 口令比较：trim 后严格相等（可做简单归一化，不要做可逆「加密」假装安全）
- `ensureStudentSession`：同名学生可 upsert（按 `studentName` where）或每次新建；默认 **同名合并同一 session 记录**，更新 `lastActiveAt`
- `track`：写 `usage-events`，并递增 session 的 `eventCount` / 刷新 `lastActiveAt`
- `isDdbConfigured()` 为 false 时：入场门仍可用（本地放行），但学情面板显示「数据未配置」空态，不要抛崩

### 接入主应用

```tsx
// 伪代码 — 按现有 App 结构嵌入
{!studentOk ? (
  <StudentGate onPass={...} />
) : (
  <>
    <ExistingLesson />
    <TeacherPortal />
  </>
)}
```

在既有关键交互处调用 `track("interact", "…")`，不要无意义刷屏。

---

## 强制流水线

口令门禁通过后，按序执行：

1. **读现状**：`sandbox.listFiles` / `sandbox.readFile` 根组件，确认挂载点
2. **写配置**：`src/content/usage-tracking.json`（含已确认口令）
3. **Schema**：`ddb.getSchema`（若有）→ 合并 → `ddb.setupSchema` → `ddb.codegen`
4. **落地模块**：`usage-tracking.ts` + `StudentGate` + `TeacherPortal`
5. **接线**：改 `App.tsx`（或等价根组件）包入场门与老师入口；关键路径打 `interact`
6. **`sandbox.typecheck`**；必要时看 Preview 报错并修
7. 最终回复用中文说明：学生如何进、老师入口在哪、口令已按老师设定配置（**不要再次全文复述口令**，可说「已写入配置」）

---

## 与其它 skill 的关系

| 情况 | 做法 |
|------|------|
| 同时做闯关/全景等新课件 | 先完成主课件骨架，再注入本 skill；或同一轮在根组件统一包 Gate |
| 只需改口令 | 只改 `usage-tracking.json`，不要重建 schema |
| 只要追踪、不要老师面板 | **不允许**省略老师入口；本 skill 规定双入口都要有 |

---

## 失败恢复

1. schema 被覆盖丢表 → `ddb.getSchema` 核对后重新合并 setup + codegen
2. `db._usage_sessions` 不存在 → 读 generated 确认连字符 kind 的 delegate 名
3. 学情空白 → 查是否未 `enter`、或 `isDdbConfigured()` 为 false
4. 改完类型报错 → `sandbox.typecheck` 按文件修，不要删追踪模块绕过
