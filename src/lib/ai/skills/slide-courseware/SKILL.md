# Slide Courseware（课件制作）

## 适用场景

- 老师要用**简单提示词**从零做一份「像 PPT 一样翻页」的多页互动课件，**无需上传参考 HTML**
- 典型需求：新授课讲解、技巧手册、专题科普、家长会/教研分享、单元知识串讲
- 需要：先与老师**确认大纲** → `image.generate` 统一风格配图 → 用 sandbox 自带的 **React Router 多页路由**落地

本技能是 **playbook**（无独立 CLI 命令）。依赖已加载的 **Sandbox**；配图用内置 `image.generate`。

**Never** 产出巨型单文件 HTML / `srcdoc` 壳、`<template class="page-data">` 外链壳、下载外链图片或写入 base64、强绑 Tailwind/Anime CDN（用项目内 CSS + 轻量 transition）、依赖 `metis-online` / `musk-online` 等外链素材。

若用户要的是**地图选关闯关**，优先 `quest-learning`；**阶段卡片+弹窗全景**，优先 `panorama-showcase`；**课文对话情景演绎**，优先 `text-interactive-game`；**已有 HTML 仿作**，优先 `interactive-quest`。不要硬套本 skill。

若本 skill 未加载而用户明确要做多页 PPT 式课件，告知启用 `slide-courseware`，不要假装跑完整流水线。

---

## 硬性门禁：先大纲，后动手

**在老师确认大纲之前，禁止** `sandbox.addFile` / `writeFile` / `apply`、禁止 `image.generate`、禁止写 React 页面。

唯一允许的「写文件」例外：无。确认前只做对话。

### 确认流程（必须）

1. 从老师消息提取课题 / 年级学科 / 页数意向 / 互动点（可缺省推断，见下表）
2. 用中文给出一份**可勾选的大纲**（见下方模板），并明确问：「请确认或指出要改的页；确认后我开始制作。」
3. 老师回复「确认 / 可以 / 没问题 / OK」或给出修改意见：
   - 有修改 → 更新大纲再确认一轮（通常一轮即可）
   - 已确认 → 进入强制流水线
4. 老师首轮提示词已含**完整分页大纲**（每页标题+用途）且明确说「按此制作 / 不用再确认」→ 可跳过反问，但仍须在回复里**复述大纲**再开工

### 大纲回复模板（对话用，勿写成文件）

```markdown
## 课件大纲（请确认）

**课题**：…
**受众**：…
**风格**：…（色板气质一句话）
**页数**：N 页

| 页序 | 页名 | 类型 | 这一页讲什么 | 互动 |
|------|------|------|--------------|------|
| 1 | 封面 | cover | … | 开始按钮 |
| 2 | … | compare / cards / … | … | 点击切换高亮 / 无 |
| … | … | … | … | … |

说明：确认后我会按此大纲生成配图并实现翻页课件；之后可用「改第 X 页…」微调。
```

---

## 内置交互骨架（权威模板）

范式来自成熟「多页互动课件」：封面开场 → 逐页讲解（页内可有轻互动）→ 收尾。翻页靠 **react-router-dom**，不是单页 state 假分页。

### Core loop（状态机）

```
outlineConfirm → cover → navigate(next|prev|dot) → pageLocalInteract? → … → closing
```

| 阶段 | 行为 |
|------|------|
| `outlineConfirm` | 与老师确认大纲；**未确认不得进入后续** |
| `cover` | 路由 `/`：主标题、副标题、封面图、「开始」→ 下一页 |
| `navigate` | 底栏上一页 / 下一页 / 圆点；支持 ← → 键；末页隐藏「下一页」或改为「再看一遍」回封面 |
| `pageLocalInteract` | 可选：点击步进高亮、步骤 stagger 入场、卡片翻转提示（每页最多一种主互动） |
| `closing` | 收尾页：总结句 + 可选简短反馈区（本地 `alert` / 文案即可，勿接外链） |

### Layout L4-slides（写死）

- **路由**（强制，挂在现有 `BrowserRouter basename={window.__PREVIEW_BASENAME__ ?? ""}` 上）：
  - 恰好一个 `<Routes>`（通常在 `App.tsx`）
  - `/` → 封面（`pages[0]`，`kind: cover`）
  - `/p/:slug` → 其余页（`slug` = 页 `id`）
  - 未知 slug → `<Navigate to="/" replace />`
- **壳层** `SlideShell`：全屏一页一屏（`min-h-dvh`）；顶栏可选课题小字；**底栏固定**：`上一页` · 圆点进度 · `下一页`；封面可用大 CTA，底栏仍保留
- **翻页**：`useNavigate` + `Link`；**禁止** `window.parent.postMessage({type:'nextPage'})`、禁止用 query 假路由代替 path
- **页内布局**：内容区 `p-8 md:p-10`，标题清晰，一屏一事；桌面优先横屏课件感，移动端可纵向堆叠不裁切
- **动效**：CSS transition / `@keyframes`（入场 fade/slide、stagger）；**不要**强绑 anime.js CDN
- 色板字段：`primary` / `primaryDark` / `accent` / `bg` / `ink` / `border`

| 主题倾向 | 建议气质 | 示例 primary |
|----------|----------|--------------|
| 自然/科学/环保 | 叶绿 | `#2D7A4F` |
| 语文/人文 | 墨青 / 绛紫 | `#0F766E` 或 `#5B21B6` |
| 数学/理工 | 靛蓝 | `#1E3A8A` |
| 历史/思政 | 沉稳朱红 | `#B91C1C` |
| 幼小/趣味 | 琥珀暖橙 | `#C2410C` |
| 用户指定 | 以用户为准 | — |

叶绿示例（自然/通用缺省之一）：

```json
{
  "primary": "#2D7A4F",
  "primaryDark": "#1f5a39",
  "accent": "#e8a020",
  "bg": "#fffbf0",
  "ink": "#1a1a0f",
  "border": "rgba(26,26,15,0.1)"
}
```

- 背景：`bg` + 轻量径向主色晕（CSS），勿外链纹理图
- 字体：可读无衬线即可（系统栈或 Noto Sans SC）；标题加粗、主色
- **禁止**儿童冒险地图风（`quest-learning`）、阶段网格+弹窗全景风（`panorama-showcase`）作为默认壳

### 页面类型 `kind`（仅允许）

| kind | 用途 | 必备内容字段 |
|------|------|----------------|
| `cover` | 封面 | `title`, `subtitle`, `coverAssetId`, CTA 文案 |
| `compare` | 左右对比 | `left` / `right`（标题+要点列表）；可选点击切换 active |
| `cards` | 2–4 张要点卡 | `cards[]`：`title`, `body`, 可选 `iconHint`（emoji 可，勿当配图替代） |
| `steps` | 步骤指引 | `steps[]`：短句；入场 stagger |
| `spotlight` | 公式/金句/示例 | `lead`, `example` 或 `bullets` |
| `icon-grid` | 类型/能力总览 | `items[]`：标题+一句说明（2×2 或 3 列） |
| `tips` | 技巧列表 | `tips[]`：标题+说明 |
| `split` | 左文右图 | `blocks[]` + `imageAssetId` |
| `timeline` | 流程总结 | `nodes[]`：2–5 步短标签 |
| `closing` | 收尾 | `title`, `message`；可选反馈 UI |

未知 kind 降级为 `cards`，并在最终回复说明。

### 默认规模

用户未指定时：

- **页数**：8–12（含封面与收尾；讲解页为主）
- **强互动页**：全课件 2–3 页（compare 点击切换 / steps 入场 / spotlight 翻转即可）
- **受众**：按老师所说；缺省「通用中小学课堂」
- **语气**：清晰、老师向、少梗

---

## 与用户对话（缺信息时）

从消息提取；**仍须走大纲确认**（除非老师已给完整分页并授权跳过）：

| 字段 | 说明 | 缺省 |
|------|------|------|
| `topic` | 课题 | 从原话推断；实在没有则只问课题 |
| `audience` | 年级/学科 | 「通用中小学」 |
| `pageCount` | 页数 | 8–12，按内容密度取 |
| `tone` | 语气 | 清晰亲切 |
| `palette` | 色板 | 按主题选（见上表） |
| `interactNeeds` | 哪几页要互动 | 推断 2–3 处，写进大纲「互动」列 |

老师只说「做个圆柱体积课件」→ 你补全合理分页大纲并请确认，**不要**直接开工。

---

## 强制流水线

必须按序。中间真相源：

`src/content/slides-blueprint.json`

### 0. Outline gate

老师确认后，把定稿大纲写入蓝图 `pages[]`（此时可 `sandbox.writeFile` 蓝图）。**未确认不得写蓝图。**

### 1. Blueprint

`sandbox.addFile` / `writeFile` 写入完整蓝图：

- `source`: `{ "path": null, "title": "…", "genre": "slide-courseware" }`
- `reuse`: `coreLoop`、`layout: "L4-slides"`、按主题的 `palette`
- `intent`: topic / audience / tone
- `pages[]`: 见 schema；`id` 用短横线英文 slug（如 `cover`, `what-is`, `core-skills`）
- `assets[]` + `styleLock`

### 2. Content design

按已确认大纲填满每页文案。**一页一个教学动作**；正文短句、要点化；禁止把整篇教案糊进一页。

### 3. Art direction + AIGC

品质依赖配图。禁止用纯色块 / 外链图 / 占位符代替必生成资产。

| 资产 | role | 数量 | 说明 |
|------|------|------|------|
| 封面主图 | `coverHero` | **1** | 封面大图 |
| 页配图 | `pageImage` | 按需 | `split` 页必有；其他页有图需求时再加 |

可选：`closingDecor` 0–1。

**硬性**：`coverHero` 必须存在且 mapped；每个声明了 `imageAssetId` / `coverAssetId` 的页都必须有对应文件，否则不得 Implement。

- `imageSize`：封面与横图页优先 **`1152x768`**；全 run 统一
- `path`：`src/assets/generated/slide-{id}.ts`
- prompt = `styleLock` + 专属描述 + 「no text, no labels, no watermark, no UI」
- 批量 `image.generate` → 核对 mapped → 再写组件
- 失败 `cli_diagnose` 重试；禁止 emoji/外链顶替未生成的图

### 4. Implement（模块边界写死）

```
src/content/slides-blueprint.json
src/content/slides-data.ts
src/components/slides/SlideShell.tsx
src/components/slides/PageCover.tsx
src/components/slides/PageCompare.tsx
src/components/slides/PageCards.tsx
src/components/slides/PageSteps.tsx
src/components/slides/PageSpotlight.tsx
src/components/slides/PageIconGrid.tsx
src/components/slides/PageTips.tsx
src/components/slides/PageSplit.tsx
src/components/slides/PageTimeline.tsx
src/components/slides/PageClosing.tsx
src/components/slides/SlidePage.tsx
src/App.tsx
```

- 可将蓝图 codegen 为 `slides-data.ts`
- `App.tsx`：扁平路由；`SlideShell` 作 layout（`element={<SlideShell />}` + `<Outlet />`）或在壳内读 `useParams` 渲染均可，但**必须**真实 path 翻页
- `SlideShell`：根据当前页索引算 prev/next；圆点 `Link`；`useEffect` 监听 ArrowLeft / ArrowRight
- `SlidePage`：按 `kind` 分发到对应 `Page*`
- 配图：`import url from "../assets/generated/....ts"`
- **禁止**主产物是带 `srcdoc` 的壳 HTML
- **禁止**再引入第二套 Router

未用到的 `Page*` 文件可省略，但 `kind` 一旦出现在蓝图中就必须有对应组件。

### 5. Verify

1. `sandbox.typecheck`
2. `sandbox.getPreviewErrors`（`wait=true`）
3. 最终中文回复勾选：
   - 大纲已获老师确认（简述最终页列表）
   - `/` 封面可读，「开始」进入第 2 页
   - 底栏上一页/下一页/圆点可用；刷新深链 `/p/{slug}` 不白屏（basename 正确）
   - 声明的配图均在 `src/assets/generated/`
   - 移动端不裁切；键盘左右可用

---

## 蓝图 schema（最小）

```json
{
  "source": { "path": null, "title": "玩转互动课件·必看小技巧", "genre": "slide-courseware" },
  "reuse": {
    "coreLoop": ["outlineConfirm", "cover", "navigate", "pageLocalInteract", "closing"],
    "layout": "L4-slides",
    "palette": {
      "primary": "#2D7A4F",
      "primaryDark": "#1f5a39",
      "accent": "#e8a020",
      "bg": "#fffbf0",
      "ink": "#1a1a0f",
      "border": "rgba(26,26,15,0.1)"
    }
  },
  "intent": {
    "topic": "互动课件制作技巧",
    "audience": "一线教师",
    "tone": "清晰实用"
  },
  "pages": [
    {
      "id": "cover",
      "kind": "cover",
      "name": "封面",
      "title": "玩转互动课件 · 必看小技巧",
      "subtitle": "AI 互动课件实测手册",
      "cta": "点击开始探索 →",
      "coverAssetId": "slide-cover"
    },
    {
      "id": "what-is",
      "kind": "compare",
      "name": "互动课件是什么",
      "title": "互动课件是什么？",
      "interact": "click-toggle",
      "left": {
        "title": "传统 PPT",
        "bullets": ["单向展示，学生被动看", "内容固定，难以实时变化"]
      },
      "right": {
        "title": "AI 互动课件",
        "bullets": ["多页结构，像 PPT 一样翻页", "主动操作，学生能点、能拖"]
      }
    },
    {
      "id": "closing",
      "kind": "closing",
      "name": "答疑与交流",
      "title": "老师，您学会了吗？",
      "message": "互动课件的魅力，在于让每一位学生都成为课堂的主角。"
    }
  ],
  "assets": [
    {
      "id": "slide-cover",
      "role": "coverHero",
      "prompt": "教师在明亮教室前展示互动课件的温馨插画场景，无文字",
      "path": "src/assets/generated/slide-cover.ts",
      "imageSize": "1152x768"
    }
  ],
  "styleLock": "清新教育插画，纸本质感，叶绿与暖金点缀，构图简洁大气，无文字无水印，"
}
```

`assets[].role` 常用：`coverHero` | `pageImage` | `closingDecor`。

页级互动 `interact` 可选值：`none` | `click-toggle` | `stagger-in` | `flip-hint`。默认 `none`。

---

## 制作后微调（老师常用）

确认落地后，老师会说「把第 5 页背景加深」「第 3 页加一张图」：

- **点名改页**：只改对应 `pages[]` 项与组件，禁止整份重做
- **增删页**：改蓝图 → 同步路由与底栏顺序 → 补/删 asset
- **一次一事**：每轮对话只改一个核心点

---

## Planner 建议步序

1. **对话**：输出大纲表，等待老师确认（此步不要写文件）
2. 确认后写 `slides-blueprint.json`（`source.path=null`，`layout: L4-slides`）
3. 填满各页文案与 `assets[]`；写 `styleLock` → **批量 `image.generate`** → 确认 mapped
4. 实现 `SlideShell` + 各 `Page*` + `App.tsx` 路由
5. `typecheck` + `getPreviewErrors`
