# Quest Learning（闯关学习）

## 适用场景

- 用户要**从零制作**闯关学习互动（地图选关、逐关答题、进度保存、通关奖励），**无需上传参考 HTML**
- 典型需求：单元作文闯关、学科知识闯关、词汇/阅读/数学/科学等分关练习
- 需要：`image.generate` 统一风格配图 → 在 sandbox 落地 React 交互页

本技能是 **playbook**（无独立 CLI 命令）。依赖已加载的 **Sandbox**；配图用内置 `image.generate`。

**Never** 产出巨型单文件 HTML / `srcdoc` 壳、下载外链图片或写入 base64、复制 `_bm_*` / analytics 噪声。

若用户**已上传参考 HTML** 且希望「按文件仿作」，优先建议启用 `interactive-quest`；本 skill 仍可独立运行，仅把参考当作可选补充，**不强制读取**。

若用户要的是**课文对话情景演绎**（封面→对白→高潮→金句），优先建议 `text-interactive-game`；若是**像 PPT 一样多页翻页讲解**，优先建议 `slide-courseware`；不要硬套本 skill。

若本 skill 未加载而用户明确要做闯关学习，告知用户启用 `quest-learning`，不要假装跑完整流水线。

---

## 内置交互骨架（权威模板）

以下结构来自成熟闯关课范式（地图选关 + 弹窗答题 + 锦囊结算 + 全屏奖励），**直接作为默认实现规格**，无需外部素材。

### Core loop（状态机）

```
cover? → map → selectLevel → present → answer → judge → feedback → successTips → reward → progress → map
```

| 阶段 | 行为 |
|------|------|
| `cover` | 可选封面：标题、副标题、年级/主题、「开始冒险」 |
| `map` | 全屏地图背景；顶部状态栏显示标题与 `已完成/总关数`；关卡按钮按 `mapPos` 绝对定位；相邻关卡间虚线路径 |
| `selectLevel` | 点击关卡图标 → 打开弹窗 |
| `present` | 弹窗内 step 圆点进度；展示当前题 |
| `answer` | 用户点选项 |
| `judge` | 判对错；错可重选，对进入下一题 |
| `feedback` | 选项高亮（对=accent，错=红）；可选短音效占位（CSS 动画即可，勿引 CDN audio） |
| `successTips` | 本关全部答对 → 展示「挑战成功」+ 本关 `tip`（知识锦囊） |
| `reward` | 关闭弹窗 → 全屏奖励卡片 + 轻量 confetti（CSS） |
| `progress` | `completedLevels` 写入 `localStorage`；地图按钮标记已完成 |

### Layout L1-map（写死）

- 地图容器：`100vh`，**必须**使用 AIGC 生成的 `mapBackground` 全屏铺底（`background-size: cover`），禁止纯色/渐变/占位图代替
- 关卡按钮：**必须**使用本关 `levelIcon` 生成图（圆形头像 + 白边 + 阴影）；下方白色圆角标题牌；hover 上浮 + 光晕；已完成加 accent 描边与 ✓ 角标
- 路径线：相邻关卡中心连线，虚线、secondary 色、半透明；可叠加轻微 pulse 动画
- 弹窗：`max-w-4xl`，圆角大卡片；头部 primary 渐变 + **同一关** `levelIcon` 大图
- 顶部状态栏：毛玻璃白底、大标题、进度 `已完成/总关数`、主题 emoji 装饰
- 色板 **B-15**（默认，可按主题微调）：

```json
{
  "primary": "#1E3A8A",
  "secondary": "#FBBF24",
  "accent": "#10B981",
  "bg": "#F0F9FF"
}
```

### 默认规模

用户未指定时：

- **关卡数**：6–8 关（与主题单元数对齐）
- **每关题数**：2–3 题 `mcq`
- **受众**：小学中高年级友好文案
- **tone**：活泼鼓励

### 交互类型（仅允许）

`mcq` | `multi` | `order` | `fill` | `rubric-checklist`

未知类型降级为 `mcq`，并在最终回复说明。

---

## 与用户对话（缺信息时）

**无需参考文件**即可开工。从用户消息提取或主动确认：

| 字段 | 说明 | 缺省 |
|------|------|------|
| `topic` | 主题（如「五年级下册单元作文」） | 从用户原话推断 |
| `audience` | 年级/学科 | 「通用小学」 |
| `levelCount` | 关卡数 | 6 |
| `questionsPerLevel` | 每关题数 | 2 |
| `cover` | 是否要封面 | `true` |
| `tone` | 语气 | 活泼鼓励 |

信息足够则**直接执行**，不要反复追问已能从上下文推断的内容。

---

## 强制流水线

必须按序执行。中间真相源固定为：

`src/content/quest-blueprint.json`

### 1. Blueprint（从模板生成，非解构）

`sandbox.addFile` / `sandbox.writeFile` 写入完整蓝图骨架：

- `source`: `{ "path": null, "title": "…", "genre": "map-quiz" }` — 无参考时 `path` 为 `null`
- `reuse`: 固定 `coreLoop`、`layout: "L1-map"`、`palette` B-15
- `intent`: 用户主题/受众/语气
- `screens`: 含 `cover`（若要）/ `map` / `level` / `reward`
- `levels[]`: 每关 `id`、`title`、`mapPos`、`tip`、`interactions[]`
- `mapPos` 预设（6 关示例，8 关可插值扩展）：

```json
[
  { "left": "15%", "top": "80%" },
  { "left": "35%", "top": "70%" },
  { "left": "55%", "top": "85%" },
  { "left": "75%", "top": "75%" },
  { "left": "85%", "top": "45%" },
  { "left": "50%", "top": "15%" }
]
```

8 关时在 `60%/35%`、`30%/40%` 等位置补点，保持地图视觉层次（下→上、左→右蜿蜒）。

### 2. Content design（先于画图）

按 `intent.topic` 填满全部关卡与题目。**一关一知识点**；反馈须解释「为什么对/错」，禁止只有「答对了」。

**作文/语文类**示例题型：审题要点、选材判断、开头结尾技法、病句辨析、修辞识别、结构排序 —— 用 `mcq` / `order` / `rubric-checklist`，避免开放长文 AI 打分。

**数学/理科类**：题干可含简单公式文本；**不要**强绑 MathJax CDN，除非用户明确要求且 Preview 可接受 esm 依赖。

---

## 视觉与配图（硬性 — 精美度核心）

地图选关页的视觉品质 **完全依赖 AIGC 配图**。禁止用 emoji / 纯色块 / CSS 渐变 / 外链图 / 占位符代替生成图。

### 必生成资产清单

| 资产 | role | 数量 | 说明 |
|------|------|------|------|
| 冒险地图 | `mapBackground` | **1** | 全屏横版地图，是选关页主视觉 |
| 关卡图标 | `levelIcon` | **= 关卡数 N** | 每关一张，与 `levels[].iconAssetId` 一一对应 |
| 封面主视觉 | `cover` | **1**（有封面时） | 与地图同风格的大画幅 |
| 奖励插画 | `reward` | 1（推荐） | 通关全屏奖励用 |

**硬性**：`assets` 中 `levelIcon` 条目数 **必须等于** `levels.length`；缺任一图标 **不得** 进入 Implement。

### 地图底图 `mapBackground`（必做）

- `imageSize`：**`1792x1024`** 或 **`1536x1024`**（横版宽屏；勿用 1024×1024 正方形）
- `path`：`src/assets/generated/map-bg.ts`
- prompt 必含：
  - 主题世界观（如「作文岛」「数学森林」「词汇王国」）
  - **俯视角/等距** 卡通冒险地图：蜿蜒小路、河流/山丘/建筑、6–8 个**空站点/平台**（不放文字、不放 UI）
  - 明亮饱和、儿童绘本质感、留足中央与边缘空白供关卡按钮 overlay
  - 「no text, no labels, no watermark, no UI buttons」
- `Map.tsx`：`backgroundImage: url(mapBg)` 全屏 cover；可加轻量 vignette 提升层次

### 关卡图标 `levelIcon`（每关必做）

- `imageSize`：**`1024x1024`**
- `path`：`src/assets/generated/lv{n}-icon.ts`（n = 关卡 id）
- 每关 prompt 必含：
  - 本关 `title` + 知识点隐喻（如审题→放大镜+作文本，选材→素材篮，开头→火箭发射）
  - **圆形图标构图**：主体居中、单焦点、高对比、少文字（prefer 无字）
  - 与 `styleLock` 完全一致的画风
- 蓝图关联：每关写 `"iconAssetId": "lv1-icon"`（对应 `assets[].id`）
- UI：`w-20~24 h-20~24 rounded-full object-cover`，白环 `ring-4 ring-white shadow-2xl`；标题牌在图标下方

### 封面 `cover`（默认开启时必做）

- `imageSize`：`1024x1024` 或 `1024x1536`
- 同 `styleLock`；表现课程主题 + 冒险召唤感；「开始冒险」按钮叠在图上

### styleLock（先写后画）

在批量 `image.generate` **之前** 写入蓝图，并作为 **每条** prompt 的固定前缀。示例：

```
儿童向高清绘本插画，柔和体积光，饱和但不过曝，圆角友好造型，统一线条粗细，冒险学习游戏美术，无文字无水印，
```

同一 run 内所有 asset **共用同一 styleLock**，保证地图、关卡 icon、封面视觉统一。

### 生成顺序与门禁

1. 内容定稿 → 列出完整 `assets[]`（1 地图 + N 图标 + 封面 + 奖励）
2. **批量** `image.generate`（可先地图 → 再各关 icon → 封面/奖励）
3. 核对：`mapped.length` = 预期；每关 `iconAssetId` 均有对应文件
4. **仅当全部配图就绪** 才写 React 组件；Implement 阶段禁止跳过或复用占位

### 3. Art direction + AIGC

1. 填蓝图 `assets[]` + `styleLock`（见上节必生成清单）
2. 对每个 asset 调 `cli_execute` → `image.generate`：
   - `prompt` = `styleLock` + 该 asset 专属描述（地图/各关 icon 按上节模板）
   - `path` = 蓝图中的 `path`
   - 尺寸：`mapBackground` 用 **`1792x1024`**；`levelIcon` / `cover` / `reward` 用 **`1024x1024`**
3. 失败用 `cli_diagnose` 重试；**禁止**用 emoji/纯色/外链替代未生成的图
4. 勿手写 SiliconFlow

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

- 可将蓝图 codegen 为 `src/content/quest-data.ts` 供强类型导入
- 状态机 = 蓝图 `coreLoop`；进度 **默认** `localStorage`（用户明确要求再用 ddb）
- 动效：CSS transition / `@keyframes`；关卡入场 scale、confetti 用纯 CSS
- **Map.tsx 精美度要求**：
  - 背景 = 生成的 `map-bg` 全屏图
  - 每关按钮 = 生成的 `lv{n}-icon` + 标题牌 + 完成态样式
  - 禁止 `<span>📚</span>` 等 emoji 代替关卡图
- 配图：`import url from "./assets/generated/....ts"`；关卡 icon 通过 `iconAssetId` 查 manifest
- **禁止**主产物是带 `srcdoc` 的壳 HTML

### 5. Verify

1. `sandbox.typecheck`
2. `sandbox.getPreviewErrors`（`wait=true`）
3. 最终中文回复勾选：
   - 封面（若有）使用 generated 图
   - **地图页背景为 AIGC 横版冒险地图**（非纯色占位）
   - **每个关卡按钮均有独立 generated icon**（数量 = 关卡数）
   - 地图可点关 → 弹窗 header 显示同关 icon → 判题反馈 → 锦囊 → 奖励动画
   - 完成标记 → 刷新进度仍在
   - 所有配图路径在 `src/assets/generated/` 且 manifest 可解析

---

## 蓝图 schema（最小）

```json
{
  "source": { "path": null, "title": "五年级下册单元作文闯关", "genre": "map-quiz" },
  "reuse": {
    "coreLoop": ["cover", "map", "selectLevel", "present", "answer", "judge", "feedback", "successTips", "reward", "progress"],
    "layout": "L1-map",
    "palette": { "primary": "#1E3A8A", "secondary": "#FBBF24", "accent": "#10B981", "bg": "#F0F9FF" }
  },
  "intent": { "topic": "五年级下册单元作文", "audience": "小学五年级", "tone": "活泼鼓励" },
  "screens": ["cover", "map", "level", "reward"],
  "levels": [
    {
      "id": "1",
      "title": "审题关",
      "iconAssetId": "lv1-icon",
      "mapPos": { "left": "15%", "top": "80%" },
      "tip": "审清题目要求，抓住关键词，别跑题哦！",
      "interactions": [
        {
          "type": "mcq",
          "prompt": "题目「难忘的一件事」最应该写什么？",
          "options": ["一件印象深的事", "很多件小事", "别人的事"],
          "answer": 0,
          "feedbackCorrect": "对！一件事写具体，比罗列多件更有感染力。",
          "feedbackWrong": "「难忘的一件事」要聚焦一件事，写细写透。"
        }
      ]
    }
  ],
  "assets": [
    {
      "id": "map-bg",
      "role": "mapBackground",
      "prompt": "俯视角卡通作文冒险岛地图，蜿蜒小路穿过森林与书房建筑，6个空圆形平台站点，河流与山丘，明亮天空，中央留空，no text no labels",
      "path": "src/assets/generated/map-bg.ts",
      "imageSize": "1792x1024"
    },
    {
      "id": "lv1-icon",
      "role": "levelIcon",
      "levelId": "1",
      "prompt": "圆形图标，放大镜审视作文题目，铅笔与稿纸，表现审题主题，单焦点居中",
      "path": "src/assets/generated/lv1-icon.ts",
      "imageSize": "1024x1024"
    },
    {
      "id": "cover-hero",
      "role": "cover",
      "prompt": "大画幅，小学生持笔站在作文冒险岛入口，欢迎开启闯关",
      "path": "src/assets/generated/cover-hero.ts",
      "imageSize": "1024x1024"
    }
  ],
  "styleLock": "儿童向高清绘本插画，柔和体积光，饱和但不过曝，圆角友好造型，统一线条粗细，冒险学习游戏美术，无文字无水印，"
}
```

`assets[].role` 常用：`mapBackground` | `cover` | `levelIcon` | `character` | `reward`。

---

## Planner 建议步序

1. 从用户意图生成 `quest-blueprint.json` 骨架（`source.path=null`，固定 L1-map / B-15）
2. 填满 `levels` / `interactions`；为每关写 `iconAssetId` 并展开完整 `assets[]`（1 地图 + N 图标 + 封面）
3. 写 `styleLock` → **批量 `image.generate`（先地图，再逐关 icon）** → 确认全部 mapped
4. 实现 `state` + 四屏组件（Map 必须挂载 map-bg 与各关 icon 生成图）
5. `typecheck` + `getPreviewErrors`
