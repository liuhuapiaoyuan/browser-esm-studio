# Interactive Quest

## 适用场景

- 用户上传/导入了参考 HTML（闯关课、地图选关、单元作文互动、教育互动页），希望**仿作同类交互**
- 需要：解构参考骨架 → 重写教学内容 → `image.generate` 统一风格配图 → 在 sandbox 落地 React 交互页

本技能是 **playbook**（无独立 CLI 命令）。依赖已加载的 **Sandbox**：所有读写走 `sandbox.*`；配图用内置 `image.generate`。

**Never** 把参考 HTML 全文塞进上下文、复制 `_bm_*` / 假 analytics meta、产出巨型单文件 HTML / `srcdoc` 壳、下载图片或写入 base64。

若本 skill 未加载而用户明确要「按参考 HTML 做闯关」，告知用户启用 `interactive-quest`，不要假装跑完整流水线。

---

## 参考入口

1. **聊天区「参考」按钮**：上传 `.html` / `.htm` → 写入虚拟项目 `references/<name>.html`，并自动启用本 skill
2. 或用户点名的其它相对路径 / 手动用文件树新建
3. 定位：`sandbox.listFiles` / `sandbox.grep`（`glob`: `references/**/*.html`）

缺文件时只问路径或请用户点「参考」上传，**不要假装已分析**。

---

## 大文件策略（硬性）

参考页常为 iframe + `srcdoc` 巨页（数十万字符）。

1. **禁止**对参考 HTML 全文 `sandbox.readFile`（估测或实际 **>80KB** 直接禁）
2. 先 `sandbox.grep`，优先这些 query：`LEVELS`、`LEVEL_DATA`、`core-loop`、`html-authoring`、`<title>`、`srcdoc`、`background-image`、`questions`
3. 再对命中处 `sandbox.readFile`（`around` / `startLine`+`endLine`）抽样
4. 检测到 `srcdoc=`：只分析内页信号，忽略外壳水印
5. **忽略** `_bm_*`、假 meta、analytics、feature-flag 噪声节点 —— 禁止仿写

---

## 强制流水线

必须按序执行；Planner 建议 5 步（见文末）。中间真相源固定为：

`src/content/quest-blueprint.json`

### 1. Deconstruct → 蓝图骨架

抽样后 `sandbox.addFile` / `sandbox.writeFile` 写入蓝图。**仿结构、不仿脏代码**：保留 core-loop / layout / 关卡级交互型；文案与图按用户 `intent` 重写。

用户说「参考这个做作文闯关」→ 把数学题换成作文题型（审题 / 选材 / 开头结尾 / 病句等），地图关卡语义一并换。

### 2. Content redesign（先于画图）

填完整 `levels[].interactions` 全文案后再进 AIGC。

- 一关目标单一；反馈须解释「为什么对/错」，禁止只有「答对了」
- 作文类：题干短、可勾选评分要点（`rubric-checklist`），避免开放长文打分幻觉
- 交互类型 **仅允许**：`mcq` | `multi` | `order` | `fill` | `rubric-checklist`；未知类型降级为 `mcq`，并在最终回复说明

### 3. Art direction + AIGC

1. 填蓝图 `assets[]` + `styleLock`
2. 对每个 asset 调 `cli_execute` → `image.generate`：
   - `prompt` = `styleLock` + 该 asset 专属描述
   - `path` = 蓝图中的 `path`（如 `src/assets/generated/map-bg.ts`）
   - level icon：圆形 crop 友好、中心构图、少文字；默认 `imageSize` `1024x1024`
3. 参考原图 URL 可作 `image` 图生图，但 **prefer 新生成**
4. 失败用 `cli_diagnose`；勿手写 SiliconFlow

### 4. Implement（模块边界写死）

```
src/content/quest-blueprint.json
src/lib/quest/state.ts
src/components/quest/Cover.tsx
src/components/quest/Map.tsx
src/components/quest/LevelPlay.tsx
src/components/quest/Reward.tsx
src/App.tsx
```

- 也可把蓝图 codegen 为 `src/content/quest-data.ts` 供强类型导入
- 状态机 = 蓝图 `coreLoop`；进度默认 `localStorage`（用户明确要求再用 ddb）
- 动效：CSS / 少量动画即可；勿强绑参考 CDN 的 anime/MathJax，除非学科确实需要公式
- 配图：`import url from "./assets/generated/....ts"` 或读 `manifest.json`
- **禁止**主产物是带 `srcdoc` 的壳 HTML

### 5. Verify

1. `sandbox.typecheck`
2. `sandbox.getPreviewErrors`（`wait=true`）
3. 最终中文回复勾选：封面→地图可点关、判题反馈、完成标记、刷新进度仍在、配图均来自 generated 模块

---

## 蓝图 schema（最小）

```json
{
  "source": { "path": "references/xxx.html", "title": "...", "genre": "map-quiz" },
  "reuse": {
    "coreLoop": ["selectLevel", "present", "answer", "judge", "feedback", "reward", "progress"],
    "layout": "L1-map",
    "palette": { "primary": "#1E3A8A", "secondary": "#FBBF24", "accent": "#10B981", "bg": "#F0F9FF" }
  },
  "intent": { "topic": "用户目标主题", "audience": "年级/学科", "tone": "活泼鼓励" },
  "screens": ["cover", "map", "level", "reward"],
  "levels": [
    {
      "id": "1",
      "title": "关卡名",
      "mapPos": { "left": "15%", "top": "80%" },
      "tip": "本关提示",
      "interactions": [
        {
          "type": "mcq",
          "prompt": "题干",
          "options": ["A", "B", "C"],
          "answer": 0,
          "feedbackCorrect": "…",
          "feedbackWrong": "…"
        }
      ]
    }
  ],
  "assets": [
    {
      "id": "map-bg",
      "role": "mapBackground",
      "prompt": "专属描述（调用时拼接 styleLock）",
      "path": "src/assets/generated/map-bg.ts",
      "imageSize": "1024x1024"
    },
    {
      "id": "lv1-icon",
      "role": "levelIcon",
      "prompt": "专属描述",
      "path": "src/assets/generated/lv1-icon.ts",
      "imageSize": "1024x1024"
    }
  ],
  "styleLock": "统一画风前缀；每条 image.generate.prompt 必须以它开头"
}
```

`assets[].role` 常用：`mapBackground` | `cover` | `levelIcon` | `character` | `reward`。

---

## Agent CLI 调度提醒

本 playbook **不**新增命令。不确定时：

1. `cli_search` — 查 `sandbox` / `image` 命令
2. `cli_describe` — 查参数
3. `cli_execute` — 执行
4. `cli_diagnose` — 失败恢复

`cli_search` / `cli_describe` / `cli_diagnose` 是独立 meta-tool，不要塞进 `cli_execute.command`。

---

## Planner 建议步序

1. 抽样分析参考 → 写 `quest-blueprint.json` 骨架（source / reuse / screens）
2. 按用户意图填满 `levels` / `interactions`
3. 填 `assets` + `styleLock` → 批量 `image.generate`
4. 实现 `state` + 四屏组件并接到 `App.tsx`
5. `typecheck` + `getPreviewErrors`
