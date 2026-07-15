# Sandbox

## 适用场景

- 读取、搜索或理解虚拟项目文件
- 新增、修改、重命名替代或删除项目文件
- 检查 TypeScript 类型错误或 Preview 运行时错误

所有项目文件操作都必须通过 `cli_execute` 调度下方 `sandbox.*` 命令。不要假设存在宿主文件系统、shell 或本地 `node_modules`。

路径一律相对路径（如 `src/App.tsx`）。窗口读取带 `LINE|` 前缀；用于 `oldString` / `newString` 时必须去掉。

---

## 命令一览（直接 `cli_execute`，无需每次 describe）

### 读 / 搜

| 命令 | 参数 | 说明 |
|------|------|------|
| `sandbox.listFiles` | `{}` 或 `{ "include": "all" }` | 列出全部文件路径 |
| `sandbox.readFile` | `path`；可选 `around`+`radius`(默认40,max80) 或 `startLine`+`endLine` | 全文或行号窗口读取 |
| `sandbox.grep` | `query`；可选 `regex`/`fuzzy`/`word`/`caseSensitive`/`paths`/`glob`/`context`(0–10)/`outputMode`(`files`\|`content`)/`maxResults` | 搜索；勿同时组合 regex/word 与 fuzzy |

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

## 工作流（简）

1. `listFiles` / `grep`(files) → `grep`(content) → `readFile`(around) → 再改
2. 单文件小改 `replaceInFile`；新文件 `addFile`；全文覆盖才 `writeFile`；跨文件一致性用 `applyOperations`
3. 改完：`typecheck`；影响 Preview 时再 `getPreviewErrors`（`wait=true`）
4. 用简短中文说明改了什么
