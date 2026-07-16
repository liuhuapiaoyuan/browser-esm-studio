# Sandbox

## 适用场景

- 读取、搜索或理解虚拟项目文件
- 新增、修改、重命名替代或删除项目文件
- 检查 TypeScript 类型错误或 Preview 运行时错误

所有项目文件操作都必须通过 `cli_execute` 调度下方 `sandbox.*` 命令。不要假设存在宿主文件系统、shell 或本地 `node_modules`。

路径一律相对路径（如 `src/App.tsx`）。窗口读取带 `LINE|` 前缀；用于 `oldString` / `newString` 时必须去掉（命令层也会尽量自动剥离，但不要依赖）。

### 配置与内容数据（硬性）

- **禁止**在 `src/**` 下用 `.json` 存应用/课件配置（蓝图、口令、关卡数据等）——Preview 沙箱内 `import *.json` 不可靠。
- **一律**用 `.ts` 模块：`export default { ... } as const;`，业务侧 `import config from '@/content/foo.ts'`（保留 `.ts` 扩展名，与邻文件一致）。
- 例外：栈文件 `package.json` / `tsconfig.json` / `components.json`；CLI 生成的 `src/assets/**/manifest.json` 仅作工具产物，不要手写 JSON 蓝图。

---

## 命令一览（直接 `cli_execute`，无需每次 describe）

### 读 / 搜

| 命令 | 参数 | 说明 |
|------|------|------|
| `sandbox.listFiles` | `{}` 或 `{ "include": "all" }` | 列出全部文件路径 |
| `sandbox.readFile` | 见下方 | 全文或行号窗口读取 |
| `sandbox.grep` | `query`；可选 `regex`/`fuzzy`/`word`/`caseSensitive`/`paths`/`glob`/`context`(0–10)/`outputMode`(`files`\|`content`)/`maxResults` | 搜索；勿同时组合 regex/word 与 fuzzy |

#### `sandbox.readFile` 参数（易错）

- **默认全文**：只传 `{ "path": "src/App.tsx" }`，不要无故加 `startLine` / `endLine` / `around`。
- **grep 后扩窗（首选）**：`{ "path": "...", "around": 40, "radius": 40 }`（`radius` 默认 40，最大 80）。
- **固定区间（少用）**：`{ "path": "...", "startLine": 10, "endLine": 80 }`。
- **行号必须是 JSON number**：写 `40`，禁止 `"40"` / `null` / `""`；缺参数就省略字段，不要填占位值。

```json
{ "command": "sandbox.readFile", "arguments": { "path": "src/App.tsx", "around": 40 } }
```

### 写

| 命令 | 参数 | 说明 |
|------|------|------|
| `sandbox.replaceInFile` | `path`, `oldString`, `newString`；可选 `regex`/`replaceAll`/`caseSensitive` | **局部修改首选** |
| `sandbox.addFile` | `path`；可选 `content` | 仅新建；已存在则失败 |
| `sandbox.writeFile` | `path`, `content` | 新建或整文件覆盖 |
| `sandbox.removeFile` | `path` | 删除；`index.html` / `package.json` 受保护 |
| `sandbox.applyOperations` | `operations: [...]` | 原子批量；失败整批回滚 |

`applyOperations` 的 `op.type` **只能是** `write` \| `add` \| `remove` \| `replace`（不要写 `writeFile` / `replaceInFile`）：

```json
{
  "operations": [
    { "type": "add", "path": "src/x.ts", "content": "export {}" },
    { "type": "write", "path": "src/y.ts", "content": "..." },
    { "type": "remove", "path": "src/tmp.ts" },
    {
      "type": "replace",
      "path": "src/App.tsx",
      "oldString": "Old",
      "newString": "New",
      "replaceAll": false,
      "regex": false
    }
  ]
}
```

### 验证

| 命令 | 参数 | 说明 |
|------|------|------|
| `sandbox.typecheck` | `{}` 或 `{ "scope": "project" }` | 改 `.ts`/`.tsx` 后必跑 |
| `sandbox.getPreviewErrors` | 可选 `wait`(默认 true)、`waitMs`(默认 1800,max 8000) | 改 UI/运行时后必跑 |

失败时用 `cli_diagnose`(executionId)；仅当参数仍不确定时才 `cli_describe`。

---

## `replaceInFile` 硬规则（防 `NO_MATCH`）

`oldString` 必须是文件里**当前存在**的逐字片段。近似、凭记忆、或带行号前缀都会 `NO_MATCH`。

### 改前

1. **先读再改**：对目标文件 `readFile`（或 `grep` → `readFile(around=命中行)`），从**刚返回的内容**拷贝 `oldString`，禁止用更早轮次/计划里的旧片段。
2. **去掉 `LINE|`**：窗口读形如 `  42|  const x = 1` → `oldString` 只能是 `  const x = 1`（含原缩进）。
3. **锚点宜短且唯一**：优先 3–12 行、含独特标识（函数名/JSX 标签/字符串字面量）。整段大块重写易因空白/逗号漂移失败。
4. **空白必须一致**：缩进、引号、尾逗号、换行与原文一致；不要“整理格式”后再当 `oldString`。
5. **同文件连续改**：上一次 `replace` 已改过的内容，下一次必须重新 `readFile` 再取新 `oldString`。

### 选择写策略

| 场景 | 用法 |
|------|------|
| 改几行 / 一个符号 | `replaceInFile`，小锚点 |
| 同串多处都要改 | `replaceAll: true` |
| 大段重写（>约 40 行）或结构大变 | 对该文件 `writeFile` 全文覆盖（先 `readFile` 全文再改） |
| 跨文件必须一起成功 | `applyOperations` |

### `NO_MATCH` 恢复（只按序做一轮，禁止盲重试同一 `oldString`）

1. `sandbox.readFile` 该 path（窗口或全文）拿**最新**原文。
2. 用更短、更独特的锚点重拼 `oldString`（仍无 `LINE|`）。
3. 仍失败：对该文件改用 `writeFile`（小文件）或缩小改动范围；不要第三次用近似字符串硬撞。

---

## 工作流（简）

1. `listFiles` / `grep`(files) → `grep`(content) → `readFile`(around) → **立刻** `replaceInFile`（`oldString` 来自刚读到的原文）
2. 单文件小改 `replaceInFile`；新文件 `addFile`；全文覆盖才 `writeFile`；跨文件一致性用 `applyOperations`
3. 改完：`typecheck`；影响 Preview 时再 `getPreviewErrors`（`wait=true`）
4. 用简短中文说明改了什么
