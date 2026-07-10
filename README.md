# Browser ESM Studio

一个类似 Lovable 的纯前端 AI 应用开发工作台：左侧 Agent Chat，右侧实时 Preview，并提供完整虚拟文件列表、源码编辑和 ZIP 导出。

## 已实现

- Vite + React + TypeScript 工作台，PC 双栏布局
- **Sandbox SDK**：有状态虚拟文件系统，统一 `grep` / `replace` / `add` / `remove` / `write` / `apply`
- 浏览器端虚拟文件系统，支持目录树、新建、编辑和删除文件
- Service Worker 将虚拟文件映射为同源 URL，原生 ESM 可直接加载多文件及循环依赖
- 根据虚拟项目的 `package.json` 自动生成 import map，npm 依赖全部从 `esm.sh` 加载
- 参考 esm.sh 官方规则固定 React 等共享依赖版本，支持 npm 包子路径
- CSS 文件导入自动转换为运行时 Style Module
- 代码修改后自动同步并刷新 iframe
- iframe 错误、Promise 异常和 Console 日志回传
- Desktop / Tablet / Mobile 三种预览宽度
- 浏览器端生成标准 ZIP，可提交服务器执行 `bun install && bun run build`
- 本地 Demo Agent（经 Sandbox SDK 改文件）；接口位置可替换为真实流式 Agent

## 运行

```bash
bun install
bun run dev
```

Service Worker 只在 `localhost` 或 HTTPS 安全上下文中运行。首次修改 `preview-sw.js` 后，建议在浏览器 DevTools 的 Application > Service Workers 中执行一次 Update。

## 验证

```bash
bun run test:sandbox
bun run test:preview
bun run test          # sandbox + preview
bun run build
```

## Sandbox SDK

虚拟文件的唯一写入口是 [`src/lib/sandbox.ts`](src/lib/sandbox.ts)。UI 与 Agent 都通过它操作；`localStorage` 持久化和 Preview Service Worker 同步仍由宿主（`App.tsx`）负责。

```ts
import { createSandbox } from "./lib/sandbox";

const sandbox = createSandbox(initialFiles);

sandbox.subscribe((files) => {
  // Host: persist + syncPreviewProject(sessionId, files)
});

sandbox.grep("description", { paths: ["src/content.ts"] });
sandbox.replace("src/content.ts", "old", "new");
sandbox.add("src/components/Card.tsx", "export function Card() { return null; }");
sandbox.write("src/App.tsx", fullSource);
sandbox.remove("src/old.tsx");
sandbox.apply([
  { type: "write", path: "src/App.tsx", content: "..." },
  { type: "remove", path: "src/old.tsx" },
]);
```

### Agent 工具面

| 方法 | 作用 |
|------|------|
| `list` / `read` / `exists` / `snapshot` | 只读查询；`snapshot` 为冻结副本 |
| `grep(query, options?)` | 跨文件搜索；支持 `regex`、`caseSensitive`、`paths`、`maxResults` |
| `replace(path, old, new, options?)` | 默认字面量、首次匹配；`replaceAll` / `regex` 需显式开启 |
| `add(path, content?)` | 新建文件；已存在则 `ALREADY_EXISTS` |
| `write(path, content)` | 整文件 upsert（编辑器 / Agent 整文件输出） |
| `remove(path)` | 删除文件；`index.html` / `package.json` 受保护 |
| `apply(operations)` | 批量原子提交；任一步失败则整批回滚 |
| `subscribe(listener)` | 每次成功提交通知一次 |

### Operation 协议

真实 Agent 应输出可序列化操作，由宿主调用 `sandbox.apply`：

```json
{
  "operations": [
    { "type": "write", "path": "src/App.tsx", "content": "..." },
    { "type": "add", "path": "src/hooks/useOrbit.ts", "content": "..." },
    { "type": "replace", "path": "src/content.ts", "oldString": "Hello", "newString": "Orbit" },
    { "type": "remove", "path": "src/old.tsx" }
  ]
}
```

### 错误码

| code | 含义 |
|------|------|
| `INVALID_PATH` | 空路径、绝对路径或非法字符 |
| `NOT_FOUND` | 文件不存在 |
| `ALREADY_EXISTS` | `add` 时路径已存在 |
| `PROTECTED_PATH` | 试图删除 Preview 必需文件 |
| `NO_MATCH` | `replace` 未命中 |
| `INVALID_OPERATION` | 非法参数或未知 operation 类型 |

### 边界

- **Sandbox**：内存中的 `FileMap` 真相源与 agent 工具面
- **Host（App）**：订阅快照 → `localStorage` + `syncPreviewProject`
- **Preview SW**：执行面镜像，不暴露给 Agent

## Preview 工作原理

1. Sandbox 维护 `{ path: source }` 格式的虚拟文件集合。
2. Host 将快照通过 `postMessage` 同步到 Service Worker，并持久化到 Cache Storage。
3. iframe 访问 `/__preview__/{sessionId}/index.html`。
4. Service Worker 返回虚拟 `index.html`，注入 `<base>`、import map 和日志桥接代码。
5. 浏览器用原生 ESM 请求相对模块；Service Worker 继续从虚拟文件系统返回对应文件。
6. `package.json` 的依赖映射为 `https://esm.sh/{package}@{version}`，不生成或安装 `node_modules`。

Preview 链路中，Service Worker 用 Sucrase 即时转译虚拟项目的 TS/TSX/JSX，再以原生 ESM 加载；npm 依赖通过 import map 指向 esm.sh。

## 接入真实 Agent

当前 `ChatPanel` 使用本地 Demo Agent，经 Sandbox SDK 演示“Agent 修改文件 → Preview 自动刷新”。生产环境建议替换为流式接口，把 tool call 映射到 SDK：

```ts
// 伪代码
for await (const tool of agent.stream(prompt)) {
  if (tool.name === "grep") yield sandbox.grep(tool.query, tool.options);
  if (tool.name === "apply") yield sandbox.apply(tool.operations);
}
```

Demo 适配器位于 [`src/lib/demoAgent.ts`](src/lib/demoAgent.ts)，只接收 `Sandbox`，返回 `{ reply, changed }`，不再回传整份 `FileMap`。

## 服务端发布建议

“Export ZIP” 生成的是虚拟项目源码，而不是本工作台源码。服务器可执行：

```bash
unzip project.zip -d /tmp/build-id
cd /tmp/build-id
bun install --ignore-scripts
bun run build
```

生产环境必须将编译任务放入一次性容器，限制 CPU、内存、网络、构建时间和输出目录，并对依赖安装脚本采用白名单策略。

## 安全边界

当前仓库为了让 Service Worker 控制 iframe 的模块请求，iframe 使用同源 Preview URL。公开部署、允许不可信代码时，应把 Preview Runtime 放到独立 Origin（例如 `preview.example.com`），工作台通过 `postMessage` 与它通信，避免预览代码读取工作台 Cookie、Local Storage 或 DOM。独立 Origin 仍然可以保持 100% 纯前端。

## 兼容范围

- 支持现代 Chromium、Firefox、Safari（需原生 ESM、import maps、Service Worker、Cache Storage）
- 支持 `.html`、`.js`、`.mjs`、`.css`、`.json` 及文本资源
- 当前虚拟文件内容为 UTF-8 文本；图片等二进制资源可后续扩展为 `{ encoding: "base64", content }`
