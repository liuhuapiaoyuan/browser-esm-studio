# AGENTS.md

## Project

Browser ESM Studio — 纯前端 AI 应用开发工作台（类似 Lovable）：左侧 Agent Chat，右侧实时 Preview，虚拟文件系统 + ZIP 导出。

Stack: **Vite 7 + React 19 + TypeScript**，包管理器 **bun**（`packageManager: bun@1.3.14`）。无后端；Preview 依赖 Service Worker + esm.sh。

## Commands

```bash
bun install
bun run dev              # Vite，--host 0.0.0.0
bun run build            # tsc --noEmit && vite build
bun run test             # sandbox + preview smoke
bun run test:sandbox     # scripts/smoke-sandbox.mjs
bun run test:preview     # scripts/smoke-preview.mjs
bun run build:runtime    # 打包 Sucrase → public/sucrase.browser.js（postinstall）
```

改动 Sandbox / Preview / Agent 相关逻辑后，至少跑对应 smoke；合并前跑 `bun run test && bun run build`。

## Architecture（硬边界）

| 层 | 职责 | 入口 |
|----|------|------|
| **Sandbox** | 虚拟文件真相源；Agent/UI 唯一写入口 | `src/lib/sandbox.ts` |
| **Host** | 订阅快照 → `localStorage` + `syncPreviewProject` | `src/App.tsx` |
| **Preview SW** | 执行面镜像；不暴露给 Agent | `public/preview-sw.js` + `src/lib/preview.ts` |

规则：

- **禁止**在 UI / Agent 里直接改 `FileMap`；一律走 `createSandbox` → `grep` / `replace` / `add` / `write` / `remove` / `apply`。
- `index.html` / `package.json` 受保护，不可 `remove`。
- 批量改文件用 `sandbox.apply(operations)`（原子；失败整批回滚）。
- Preview 不装 `node_modules`：依赖经 import map → `https://esm.sh/...`；TS/TSX 由 SW 内 Sucrase 转译。

真实 Agent 应输出可序列化 operations，由宿主调用 `sandbox.apply`。入口：`src/lib/ai/agent.ts`（Plan → Executor，经 Sandbox tools 改文件）。API 配置：`src/lib/ai/settings.ts`（localStorage + Vite 代理）。

## Layout

```
src/
  App.tsx              # 工作台宿主
  defaultProject.ts    # 默认虚拟项目模板
  types.ts             # FileMap 等共享类型
  lib/ai/              # Vercel AI SDK Plan→Executor + OpenAI-compatible provider
  lib/sandbox.ts       # Sandbox SDK
  lib/preview.ts       # SW 注册与同步
  lib/path.ts          # 路径规范化 / 文件树
  lib/zip.ts           # 浏览器端 ZIP
public/
  preview-sw.js        # Preview Service Worker
  sucrase.browser.js   # 构建产物，勿手改
scripts/               # smoke 测试
.agents/skills/        # Agent skills（如 ai-sdk）
```

## Conventions

- ESM only（`"type": "module"`）；路径用 `normalizePath`，相对路径，无绝对路径。
- `FileMap` 视为不可变快照；类型见 `src/types.ts`。
- 改 `preview-sw.js` 后需在 DevTools → Application → Service Workers 执行 Update；SW 仅在 `localhost` / HTTPS 可用。
- 接入 AI SDK 时先读 `.agents/skills/ai-sdk/SKILL.md`，**不要凭记忆写 API**；以已安装 `ai` 包内 docs/source 为准。
- 保持纯前端；不要引入需要 Node 服务端才能跑 Preview 的依赖。
- 最小化改动：不顺手重构无关文件；不主动加文档除非被要求。

## Security

同源 Preview 是为了让 SW 拦截模块请求。公开部署且预览不可信代码时，Preview 应放到独立 Origin，经 `postMessage` 通信。Export ZIP 是**虚拟项目**源码，不是本工作台源码。

## Do not

- 手改 `public/sucrase.browser.js`（用 `bun run build:runtime`）
- 绕过 Sandbox 写文件或让 Agent 直接碰 Preview SW
- 在虚拟项目里假设存在本地 `node_modules`
- 提交密钥 / `.env` 中的真实凭据
