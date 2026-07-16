# Panorama Showcase（历程全景）

## 适用场景

- 用户要**从零制作**「阶段卡片 + 详情弹窗 + 知识测验」式全景学习页，**无需上传参考 HTML / 图片 / 音频**
- 典型需求：历史历程全景、单元知识概览、人物/事件展板、专题阶段梳理、思政/党史类课件
- 需要：`image.generate` 统一风格阶段封面图 → 在 sandbox 落地 React 交互页
- 需要: `speech.generate` 在每个卡片配合 `speaker` 生成音频，并写入蓝图 `speechAssetPath`，查看卡片自动播放音频
- 需要: `sfx.map` 交互音效

若用户**已上传参考 HTML** 且希望「按文件仿作」，优先建议启用 `interactive-quest`；本 skill 仍可独立运行，仅把参考当作可选补充，**不强制读取**。

若用户要的是**地图选关闯关答题**，优先建议 `quest-learning`；若是**课文对话情景演绎**，优先建议 `text-interactive-game`；若是**像 PPT 一样多页翻页讲解**，优先建议 `slide-courseware`；不要硬套本 skill。

若本 skill 未加载而用户明确要做历程全景 / 阶段展板类课件，告知用户启用 `panorama-showcase`，不要假装跑完整流水线。

---

## 内置交互骨架（权威模板）

以下结构来自成熟「历程全景展示」范式（标题导读 → 阶段卡片网格 → 详情弹窗 → 底部测验），**直接作为默认实现规格**，无需外部素材。

### Core loop（状态机）

```
browse → selectStage → openModal → readDetail → closeModal → quiz → submit → score
```

| 阶段 | 行为 |
|------|------|
| `browse` | 顶栏标题卡 + 副标题；下方阶段卡片网格；底部测验区可同屏可见 |
| `selectStage` | 点击某张阶段卡片 |
| `openModal` | 打开详情弹窗（模糊遮罩 + 纸张卡片入场） |
| `readDetail` | 展示封面图、关键节点、代表人物、详述、历史意义 |
| `closeModal` | 关闭弹窗，回到浏览 |
| `quiz` | 底部「知识挑战」多选题（可先浏览再答） |
| `submit` | 校验是否全部作答 |
| `score` | 显示得分与鼓励文案 |

### Layout L2-panorama（写死）

- **顶栏**：居中纸张质感标题卡（双线/墨色边框），主标题 + 金色分割线 + 副标题；可选「导读」按钮（无真实音频时仅作视觉 CTA 或省略）
- **阶段网格**：桌面 `md:grid-cols-3` 或 `md:grid-cols-4`（阶段数 3→3 列，4→4 列，5–6→3 列）；移动端单列
- **阶段卡片**（每张必须含）：
  - 顶部封面图（AIGC，`object-cover`，hover 轻微放大）
  - 右上角时期/年份徽章
  - 叠压圆形序数（壹/贰/叁… 或 01/02…）
  - 主标题 + 副标题
  - 2 条要点（`转折/道路/统一战线` 这类「标签：内容」）
  - 底部「点击查看详情 →」
  - hover：上浮 + 阴影加深（`card-hover`）
- **时间轴线**（桌面可选）：卡片背后一条半透明 accent 横线，暗示历程连续
- **详情弹窗**：`max-w-4xl`；左图右文（移动端上图下文）；字段固定为：
  - 关键节点（逗号分隔短列表）
  - 代表人物
  - 史实/知识详述（一段完整叙述）
  - 意义/小结（左侧强调色条引用块）
- **测验区**：纸张卡片容器；渲染 `questions[]`；提交后显示 `得分 x/n` + 鼓励语
- 色板：**禁止默认一律用红色**。按 `topic` / 学科气质选主色，须保持「纸张 + 主色边框」气质；结构字段固定为 `primary` / `secondary` / `accent` / `paper` / `ink` / `wood`。

| 主题倾向 | 建议主色气质 | 示例 primary |
|----------|--------------|--------------|
| 党史/革命/思政 | 沉稳朱红（H-red，**仅此类默认**） | `#B91C1C` |
| 科技/工程/航天 | 靛蓝 / 青蓝 | `#1E3A8A` |
| 自然/地理/生态 | 墨绿 / 苔绿 | `#166534` |
| 文学/艺术/文化 | 绛紫 / 黛青 | `#5B21B6` 或 `#0F766E` |
| 经济/商贸 | 琥珀 / 深褐 | `#B45309` |
| 用户指定色 | 以用户色为准，派生 secondary/accent | — |

H-red 示例（**仅**历史/思政类可作缺省）：

```json
{
  "primary": "#B91C1C",
  "secondary": "#7F1D1D",
  "accent": "#F59E0B",
  "paper": "#FFFBEB",
  "ink": "#111827",
  "wood": "#92400E"
}
```

- 页面背景：`secondary` 底 + 轻量 SVG 纹理（十字/噪点即可，纯 CSS/SVG data URI，勿外链）；纹理色跟随主色，勿强行红底
- 字体：衬线标题（可用系统宋体栈或 Google Fonts Noto Serif SC）；正文可读即可
- **禁止**默认套用儿童冒险地图风（那是 `quest-learning`）
- **禁止**非红色主题仍写死 `#B91C1C` / 「沉稳红色」styleLock

### 默认规模

用户未指定时：

- **阶段数**：4（与典型「四段历程」对齐；也可 3 / 5 / 6）
- **每阶段要点**：2 条
- **测验题数**：3 题 `mcq`
- **受众**：中学/通用；语气庄重清晰，忌油滑梗
- **音频**：默认 **不做**真实播放（无用户提供 URL 时不要伪造外链 mp3）；弹窗可不放播放按钮

### 交互类型（测验仅允许）

`mcq`（默认）| `multi`

未知类型降级为 `mcq`，并在最终回复说明。

---

## 与用户对话（缺信息时）

**无需参考文件 / 素材**即可开工。从用户消息提取或主动确认：

| 字段 | 说明 | 缺省 |
|------|------|------|
| `topic` | 主题（如「新民主主义革命历程」） | 从用户原话推断 |
| `audience` | 年级/学科 | 「通用中学」 |
| `stageCount` | 阶段数 | 4 |
| `quizCount` | 测验题数 | 3 |
| `tone` | 语气 | 庄重清晰 |
| `palette` | 色板 | **按主题选色**（勿默认红）；党史/思政可用 H-red，其余见上表 |

信息足够则**直接执行**，不要反复追问已能从上下文推断的内容。

---

## 强制流水线

必须按序执行。中间真相源固定为：

`src/content/panorama-blueprint.ts`

### 1. Blueprint（从模板生成，非解构）

`sandbox.addFile` / `sandbox.writeFile` 写入完整蓝图骨架：

**文件格式（硬性）**：`.ts` 模块，`export default { ... } as const;`；Implement 时 `import blueprint from '@/content/panorama-blueprint.ts'`。**禁止** `.json` 蓝图或 `import *.json`。

- `source`: `{ "path": null, "title": "…", "genre": "stage-panorama" }` — 无参考时 `path` 为 `null`
- `reuse`: 固定 `coreLoop`、`layout: "L2-panorama"`；`palette` **按主题选定**（非党史/思政勿默认 H-red）
- `intent`: 用户主题/受众/语气
- `screens`: `["header", "stages", "modal", "quiz"]`
- `stages[]`: 每阶段见下方 schema
- `questions[]`: 测验题

### 2. Content design（先于画图）

按 `intent.topic` 填满全部阶段与测验。**一阶段一核心叙事**；详述须完整可读（约 80–160 字），禁止只有标题没有内容。

字段填写规范：

| 字段 | 要求 |
|------|------|
| `period` | 年份或时期，如 `1919 - 1921` |
| `ordinal` | 中文数字壹贰叁…（超过拾可用阿拉伯数字） |
| `title` / `subtitle` | 阶段名 + 一句概括 |
| `bullets` | 恰好 2 条，`{ "label", "text" }` |
| `nodes` | 3–5 个关键节点，顿号或逗号连接字符串 |
| `people` | 2–5 位代表人物 |
| `detail` | 连贯史实/知识叙述 |
| `significance` | 1–2 句意义小结 |
| `questions` | 紧扣各阶段知识点；含易混淆选项；`answer` 为选项字母或 0-based 索引（实现时统一） |

**历史/思政类**：史实表述须谨慎、中性、符合通行教材表述；不确定时用稳妥表述，勿编造冷门「史实」。

**非历史类**（如科学阶段、文学流派）：把「史实详述/历史意义」语义改为「知识详述/阶段小结」，字段名可保持以降低组件分支。

---

## 视觉与配图（硬性）

阶段卡片与弹窗封面的品质 **依赖 AIGC 配图**。禁止用 emoji / 纯色块 / 外链图 / 占位符代替生成图。

### 必生成资产清单

| 资产 | role | 数量 | 说明 |
|------|------|------|------|
| 阶段封面 | `stageCover` | **= 阶段数 N** | 每阶段一张，卡片顶图与弹窗左图共用 |

可选（用户明确要求时再做）：

| 资产 | role | 数量 |
|------|------|------|
| 页头装饰 | `headerDecor` | 0–1 |

**硬性**：`assets` 中 `stageCover` 条目数 **必须等于** `stages.length`；缺任一封面 **不得** 进入 Implement。

### 阶段封面 `stageCover`

- `imageSize`：**`1024x1024`** 或 **`1152x768`**（横版更贴卡片顶图；二选一后全 run 统一）
- `path`：`src/assets/generated/stage-{id}-cover.ts`
- prompt 必含：
  - 本阶段主题意象（事件/场景/象征物，**不要**在图上写汉字标题）
  - 与 `styleLock` 一致的画风（默认：水墨/油画感历史插画或专题纪实插画，庄重、少卡通）
  - 「no text, no labels, no watermark, no UI」
- 蓝图关联：每阶段 `"coverAssetId": "stage-xingqi-cover"`
- UI：卡片 `h-48` cover；弹窗左侧同图

### styleLock（先写后画）

在批量 `image.generate` **之前** 写入蓝图，并作为 **每条** prompt 的固定前缀。色调须与已选 `palette` 一致，**勿**凡历程页都写「沉稳红色」。

党史/革命主题示例：

```
庄重历史主题插画，略带纸本与油画质感，沉稳朱红与暖赭点缀，构图大气，人物与场景清晰可读，无文字无水印，
```

科技主题示例：

```
庄重科普主题插画，略带纸本与信息图质感，靛蓝与青灰点缀，构图大气，场景清晰可读，无文字无水印，
```

其他主题改对应气质与主色词（如「墨绿与苔色」「黛青水彩」），同一 run 内所有 asset **共用同一 styleLock**。

### 生成顺序与门禁

1. 内容定稿 → 列出完整 `assets[]`（N 张 stageCover）
2. **批量** `image.generate`
3. 核对：`mapped.length` = N；每阶段 `coverAssetId` 均有对应文件
4. **仅当全部配图就绪** 才写 React 组件

### 3. Art direction + AIGC

1. 填蓝图 `assets[]` + `styleLock`
2. 对每个 asset 调 `cli_execute` → `image.generate`：
   - `prompt` = `styleLock` + 该 asset 专属描述
   - `path` = 蓝图中的 `path`
   - `imageSize` 按上节
3. 失败用 `cli_diagnose` 重试；**禁止**用 emoji/纯色/外链替代未生成的图
4. 勿手写 SiliconFlow

### 4. Implement（模块边界写死）

```
src/content/panorama-blueprint.ts
src/content/panorama-data.ts
src/components/panorama/Header.tsx
src/components/panorama/StageGrid.tsx
src/components/panorama/StageCard.tsx
src/components/panorama/DetailModal.tsx
src/components/panorama/Quiz.tsx
src/App.tsx
```

- 可将蓝图直接 import，或按需 codegen 为 `panorama-data.ts` 供派生数据
- 弹窗开关用 React state（`selectedStageId: string | null`）
- 动效：CSS transition / `@keyframes`（卡片入场 stagger、弹窗 scale/opacity）；**不要**强绑 anime.js CDN
- 纸张纹理、墨色双线边框、背景图案用项目内 CSS（可参考：`paper` 底 + 低透明噪点 SVG）
- 配图：`import url from "../assets/generated/....ts"`；经 `coverAssetId` 查表
- 测验：受控 radio；未答完提示「请回答所有问题后再提交」；答完显示得分
- **禁止**主产物是带 `srcdoc` 的壳 HTML
- **禁止**依赖 `metis-online` / `musk-online` 等外链素材 URL

### 5. Verify

1. `sandbox.typecheck`
2. `sandbox.getPreviewErrors`（`wait=true`）
3. 最终中文回复勾选：
   - 顶栏标题 + 阶段网格可读
   - **每个阶段卡片均有独立 generated 封面图**（数量 = 阶段数）
   - 点击卡片 → 弹窗展示节点/人物/详述/意义 → 可关闭
   - 底部测验可作答、提交、显示得分
   - 移动端单列与弹窗不裁切
   - 所有配图路径在 `src/assets/generated/` 且 manifest 可解析

---

## 蓝图 schema（最小）

下列示例主题为党史历程，故用 H-red；**换主题时必须同步换 `palette` 与 `styleLock` 主色词**，勿照抄红色。

```json
{
  "source": { "path": null, "title": "新民主主义革命历程全景", "genre": "stage-panorama" },
  "reuse": {
    "coreLoop": ["browse", "selectStage", "openModal", "readDetail", "closeModal", "quiz", "submit", "score"],
    "layout": "L2-panorama",
    "palette": {
      "primary": "#B91C1C",
      "secondary": "#7F1D1D",
      "accent": "#F59E0B",
      "paper": "#FFFBEB",
      "ink": "#111827",
      "wood": "#92400E"
    }
  },
  "intent": { "topic": "新民主主义革命历程", "audience": "初中历史", "tone": "庄重清晰" },
  "screens": ["header", "stages", "modal", "quiz"],
  "header": {
    "title": "新民主主义革命历程",
    "subtitle": "从五四觉醒到新中国诞生的伟大跨越"
  },
  "stages": [
    {
      "id": "xingqi",
      "ordinal": "壹",
      "period": "1919 - 1921",
      "title": "新民主主义革命兴起",
      "subtitle": "五四运动与中共诞生",
      "coverAssetId": "stage-xingqi-cover",
      "bullets": [
        { "label": "转折", "text": "五四运动是新民主主义革命开端" },
        { "label": "诞生", "text": "1921年中国共产党成立" }
      ],
      "nodes": "五四运动(1919)、中共一大(1921)",
      "people": "陈独秀、李大钊、毛泽东、董必武",
      "detail": "1919年巴黎和会外交失败引发五四运动……",
      "significance": "五四运动促进了马克思主义的传播；中共成立使革命有了坚强的领导核心。"
    }
  ],
  "questions": [
    {
      "id": "q1",
      "prompt": "标志着中国新民主主义革命开端的历史事件是？",
      "options": ["A. 辛亥革命", "B. 五四运动", "C. 中共一大召开", "D. 北伐战争"],
      "answer": "B"
    }
  ],
  "assets": [
    {
      "id": "stage-xingqi-cover",
      "role": "stageCover",
      "stageId": "xingqi",
      "prompt": "五四运动与建党时期历史场景意象，学生与工人觉醒，庄重暖色，无文字",
      "path": "src/assets/generated/stage-xingqi-cover.ts",
      "imageSize": "1152x768"
    }
  ],
  "styleLock": "庄重历史主题插画，略带纸本与油画质感，沉稳朱红与暖赭点缀，构图大气，人物与场景清晰可读，无文字无水印，"
}
```

`assets[].role` 常用：`stageCover` | `headerDecor`。

---

## Planner 建议步序

1. 从用户意图生成 `panorama-blueprint.ts` 骨架（`source.path=null`，固定 L2-panorama；**按主题选 palette，勿默认红**）
2. 填满 `stages` / `questions`；为每阶段写 `coverAssetId` 并展开完整 `assets[]`
3. 写与 palette 一致的 `styleLock` → **批量 `image.generate`** → 确认全部 mapped
4. 实现 Header / StageGrid / DetailModal / Quiz 并接到 `App.tsx`
5. `typecheck` + `getPreviewErrors`
