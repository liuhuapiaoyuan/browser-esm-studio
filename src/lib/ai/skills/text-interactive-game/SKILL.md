# Text Interactive Game（课文互动游戏）

## 适用场景

- 用户要**从零制作**「封面 → 角色对话 → 高潮互动 → 金句结局」式课文沉浸体验，**无需上传参考 HTML / 图片 / 音频**
- 典型需求：语文课文情景再现（《军神》《狼牙山五壮士》《草船借箭》等）、人物对话演绎、戏剧化阅读、思政/历史短剧式课件
- 需要：`image.generate` 统一风格场景与角色图 → `sfx.map` 交互音效 → 可选 `speech.generate` 对白/结局语音 → 在 sandbox 落地 React 交互页


若用户要的是**地图选关闯关答题**，优先建议 `quest-learning`；若是**阶段卡片全景展板**，优先建议 `panorama-showcase`；若是**像 PPT 一样多页翻页讲解**，优先建议 `slide-courseware`；不要硬套本 skill。

若本 skill 未加载而用户明确要做课文互动 / 对话情景游戏，告知用户启用 `text-interactive-game`，不要假装跑完整流水线。

---

## 内置交互骨架（权威模板）

以下结构提炼自成熟「课文互动游戏」范式（以《军神》式四幕为例：开场 → 问诊对话 → 手术坚持 → 军神赞誉），**直接作为默认实现规格**，无需外部素材。

### Core loop（状态机）

```
cover → dialogue → (optional choices) → climax → ending → replay?
```

| 阶段 | 行为 |
|------|------|
| `cover` | 全屏氛围底图；大标题 + 副标题 +「开始体验」（`start` 音效）；衬线/文学气质 |
| `dialogue` | 双角色立绘并排；当前说话者高亮；底部对话框打字机出字；关键句可播 TTS；「▼ 点击继续」推进（`click`） |
| `choices`（可选） | 某句对话后弹出 1–2 个选项；选择影响下一句或直接进入 climax（选中 `click`；默认多数课文**无分支**，线性推进即可） |
| `climax` | 课文高潮互动（默认 `click-meter`：连点积累进度，按钮 `click` 节流，完成 `success`） |
| `ending` | 主角圆形肖像 + 金句逐字浮现；可选播放旁白音频；「再读一遍」重开（可配 `applause` 音效） |
| `replay` | `location` 式整页重置或重置 state 回到 `cover` |

### Layout L3-lesson-drama（写死）

- **全屏场景机**：同一时刻只显示一个 `scene`；切换用 opacity fade（300–500ms），**禁止**多场景叠乱
- **背景层**：AIGC `sceneBackground` 全屏 `object-cover` + 半透明主色渐变遮罩 + 轻量 SVG 纹理（十字/噪点 data URI，勿外链）
- **封面**：居中标题区；标题字号大、字距略宽；副标题一句情境；主按钮复古按压感（下阴影，`:active` 下沉）
- **对话区**：
  - 上半：两名角色立绘（各约屏宽 1/3），底部姓名牌
  - 下半：毛玻璃对话框（白底高透明 + 主色描边）；打字机文字；右下角「继续」
  - 说话者切换：当前 `scale-100 opacity-100`，另一角色 `scale-95 opacity-50`
- **高潮区**：居中环形进度或大号计数 + 状态文案 + 主操作按钮；点击时整场景轻微 shake
- **结局区**：暗遮罩 + 圆形肖像 + 金句；按钮组延迟淡入
- 色板**由 Agent 按课文自主设计**，结构字段固定：`primary` / `secondary` / `accent` / `dark`（用户指定色优先，见下表）

**配色原则（每次 run 须产出独特组合，禁止无脑复用同一套 hex）**

| 角色 | 职责 |
|------|------|
| `primary` | 主叙事色：按钮、描边、标题强调；承载课文情绪基调 |
| `secondary` | 大面积衬底/对话框底：高明度、低饱和，保证长文可读 |
| `accent` | 点睛色：金句、进度、高亮；与 primary 有对比但同气质 |
| `dark` | 遮罩/阴影/结局暗场：primary 的加深变体，非纯黑 |

**从课文推导气质（至少综合 2 项再定色，勿套模板）**

- **时代与场景**：近代军旅、唐宋山水、民国学堂、神话仙境、都市校园……
- **情感弧**：悲壮坚毅、诙谐童趣、悬疑紧张、温情治愈、豪迈激昂……
- **课文意象**：刀锋/钢铁、江雾/月色、稻浪/炊烟、烽火/红旗、竹石/青松……
- **受众语气**：低幼宜暖亮饱和；初中宜克制、略复古或文艺

**灵感方向（仅作发散，须改写为本次专属 hex，可跨类混搭）**

| 气质关键词 | 可参考色相区间（自行取具体色值） |
|------------|----------------------------------|
| 军旅/意志/劳动 | 军绿、橄榄、铁锈赭、旧帆布米 |
| 古诗文/水墨 | 墨青、黛蓝、宣纸米、朱砂/泥金点缀 |
| 神话/寓言/童话 | 琥珀、茜红、薄荷、薰衣草、天青 |
| 历史/谍战/悬疑 | 烟灰蓝、炭黑、暗红、煤油灯黄 |
| 自然/田园/科普 | 麦金、苔绿、天青、泥土褐 |
| 校园/青春/现代 | 靛蓝、雾粉、薄荷青、浅灰紫 |
| 革命/红色经典 | 绛红、砖红、米白、深松绿对比 |
| 科幻/奇幻 | 电蓝、紫晶、霓虹青、深空紫 |

定稿后自检：`secondary` 与对话框白字/深字对比足够；`accent` 在 `primary` 底上可辨认；四色同一插画气质（写入 `styleLock`）。

| 用户指定色 | 以用户为准，可只给 primary 由 Agent 推导其余三色 |

缺省参考（**仅**用户未指定且课文为军旅/意志类时可用；其他课文必须自设计）：

```json
{
  "primary": "#2D593E",
  "secondary": "#EBEDD4",
  "accent": "#AE7645",
  "dark": "#1D422B"
}
```

- 字体：衬线标题（Noto Serif SC 或系统宋体栈）；正文可读
- **禁止**默认套用儿童冒险地图风（`quest-learning`）或阶段卡片展板风（`panorama-showcase`）
- **禁止**依赖 `metis-online` / `musk-online` 等外链素材 URL

### 默认规模

用户未指定时：

- **角色数**：2（主角 + 对手/配角）
- **对白条数**：6–10 句（紧扣课文关键对话，勿灌水）
- **高潮类型**：`click-meter`（目标值按课文意象，如「72 刀」→ `target: 72`）
- **结局金句**：1 句（课文点题名句或老师赞语）
- **结局旁白**：默认 **生成**（`speech.generate`，短句 = 金句全文）；用户明确不要语音则跳过
- **交互音效**：默认 **开启**（`sfx.map` 映射 `start` / `click` / `success` / `applause`，见下节）
- **对白朗读**：默认 **关键句**（`dialogueSpeech: "keyLines"`，2–4 条转折/点题对白）；用户要全配音 → `all`；明确不要 → `none`
- **受众**：小学中高年级 / 初中语文；语气庄重共情，忌油滑梗
- **分支选项**：默认关闭（`choicesEnabled: false`）

### 高潮互动类型（仅允许）

| type | 玩法 | 适用 |
|------|------|------|
| `click-meter` | 连点累加至 `target`；阶段性 `statusLines` | 意志考验、坚持、劳动累计（默认） |
| `choice-climax` | 1 个关键抉择（2–3 选项），选后进结局 | 道德两难、人物抉择 |
| `reveal-tap` | 逐次点击揭开 3–5 个关键词/意象 | 象征物、景物描写高潮 |

未知类型降级为 `click-meter`，并在最终回复说明。

### 音效与语音（沉浸增强）

课文戏剧感除画面外，**轻量音效 + 选择性 TTS** 能显著提升课堂体验。二者分工：

| 类型 | 命令 | 用途 |
|------|------|------|
| 短音效 | `sfx.list` → `sfx.map` | 按钮反馈、场景切换、高潮达成、结局鼓掌 |
| 语音朗读 | `speech.generate` | 角色对白、结局金句旁白 |

**禁止**在组件里手写外链 mp3 / SiliconFlow fetch；音效一律 `sfx.map`，语音一律 `speech.generate`。

#### 音效（默认开启）

1. `cli_execute` → `sfx.list` 浏览目录（不确定 id 时）
2. 一次 `sfx.map` 写入 sandbox（默认路径 `src/assets/sfx/<id>.ts`）
3. 实现侧封装 `playSfx(url)`，`audio.play().catch(() => {})` 吞掉自动播放限制

**默认映射 id**（可按课文气质替换同类 id，勿堆太多）：

| id | 触发时机 |
|----|----------|
| `start` | 封面「开始体验」点击 |
| `click` | 对话「继续」、选项选中、高潮操作按钮、结局「再读一遍」 |
| `success` | 高潮互动完成（如 `click-meter` 点满） |
| `applause` | 结局金句完整浮现后（可选，庄重课文可省略改 `ding`） |

可选增强（按需 `sfx.map`，勿全绑）：

| id | 适用 |
|----|------|
| `knock` | 从封面进入对话、重大转折前 |
| `ding` | 说话者切换、弹出选项 |
| `coin` | 高潮进度每过一档 `statusLines` 里程碑 |
| `cheer` | 童趣/庆祝向课文结局 |

高潮连点场景：`click` **节流**（如 ≥120ms 间隔），避免音效叠成噪音。

#### 对白语音（选择性生成）

蓝图 `audio.dialogueSpeech`：

| 值 | 行为 |
|----|------|
| `none` | 仅打字机，不生成对白 TTS |
| `keyLines`（默认） | 仅为 `speech: true` 的 2–4 条关键对白生成 |
| `all` | 每条 `dialogues[]` 均生成（用户明确要求「全配音」时） |

生成规则：

- 每条待合成对白 `text` **去掉括号神态**，保留可读台词；单条 ≤60 字为宜
- `speaker` 绑定角色：`characters[].voice`（如 `charles` / `diana`）；缺省时按角色性别/气质推断
- 路径：`src/assets/generated/audio/dialogue-{序号}.ts`（与蓝图 `speechAssetPath` 一致）
- 播放：该句打字机开始时 `play()`；用户点「继续」时 `pause()` 并切下一句
- 结局旁白独立：`ending.speechAssetPath`，金句浮现后再播，勿与最后一句对白抢播

**speaker 参考**：庄重男声 `charles` / `david`；沉稳女声 `diana` / `anna`；少年感 `bella` / `alex`（按角色微调 `speed` 0.9–1.1）

用户说「不要语音 / 不要配音」→ `dialogueSpeech: "none"` 且 `withEndingSpeech: false`，但仍可保留轻量 `sfx`。

---

## 与用户对话（缺信息时）

**无需参考文件 / 素材**即可开工。从用户消息提取或主动确认：

| 字段 | 说明 | 缺省 |
|------|------|------|
| `topic` / 课文名 | 如「军神」「草船借箭」 | 从用户原话推断；实在没有则反问课文名 |
| `audience` | 年级 | 「小学高年级」 |
| `tone` | 语气 | 庄重共情 |
| `climaxType` | 高潮玩法 | `click-meter` |
| `withEndingSpeech` | 是否生成结局旁白 | `true` |
| `dialogueSpeech` | 对白朗读范围 | `keyLines`（2–4 条关键句） |
| `withSfx` | 是否映射交互音效 | `true` |
| `palette` | 色板 | **Agent 按课文自主设计**四色；用户指定优先；军旅/意志类缺省可用《军神》绿 |

信息足够则**直接执行**，不要反复追问已能从上下文推断的内容。

课文内容须依据通行教材表述；不确定细节时用稳妥、广泛收录的情节与对白，**禁止编造**违背课文原意的关键事实。

---

## 强制流水线

必须按序执行。中间真相源固定为：

`src/content/lesson-game-blueprint.json`

### 1. Blueprint（从模板生成，非解构）

`sandbox.addFile` / `sandbox.writeFile` 写入完整蓝图骨架：

- `source`: `{ "path": null, "title": "…", "genre": "lesson-drama" }` — 无参考时 `path` 为 `null`
- `reuse`: 固定 `coreLoop`、`layout: "L3-lesson-drama"`；`palette` **按课文自主设计**（非军旅类禁止默认套用《军神》绿）
- `intent`: 用户主题/受众/语气
- `screens`: `["cover", "dialogue", "climax", "ending"]`
- `characters[]` / `dialogues[]` / `climax` / `ending`：见下方 schema

### 2. Content design（先于画图）

按课文填满对白与高潮语义。

| 字段 | 要求 |
|------|------|
| `characters` | 恰好 2 人（缺省）；含 `id`、`name`、`role`（protagonist/deuteragonist） |
| `dialogues[]` | 每条：`speaker`、`text`（可含括号神态）、`action`（情绪标签）；可选 `speech: true`（纳入 TTS）；生成后填 `speechAssetPath` |
| `climax` | `type` + 文案；`click-meter` 须有 `target`、`buttonLabel`、`statusLines[]`（按进度区间） |
| `ending.quote` | 点题金句，宜短（≤40 字为佳，最长不超过 60 字） |
| `cover.title` / `subtitle` | 课文名 + 一句情境召唤 |

对白顺序须服务叙事弧：铺垫 → 冲突/揭示 → 决心 → 自然过渡到 climax。

`audio` 块（写入蓝图）：

```json
{
  "withSfx": true,
  "sfxIds": ["start", "click", "success", "applause"],
  "dialogueSpeech": "keyLines",
  "withEndingSpeech": true
}
```

---

## 视觉与配图（硬性）

沉浸感 **依赖 AIGC 场景与角色图**。禁止用 emoji / 纯色块 / 外链图 / 占位符代替生成图。

### 必生成资产清单

| 资产 | role | 数量 | 说明 |
|------|------|------|------|
| 场景背景 | `sceneBackground` | **1** | 封面/对话/高潮共用氛围底（可加遮罩区分场景） |
| 角色立绘 | `character` | **= 角色数**（默认 2） | 半身/全身立绘，透明感构图友好，少文字 |
| 结局肖像 | `endingPortrait` | **1** | 圆形裁切友好；通常为主角特写 |

**硬性**：`character` 条目数 **必须等于** `characters.length`；缺任一立绘或背景 **不得** 进入 Implement。

### 场景背景 `sceneBackground`

- `imageSize`：**`1792x1024`** 或 **`1536x1024`**
- `path`：`src/assets/generated/scene-bg.ts`
- prompt 必含：课文时空场景（如「1916 年诊所室内」「赤壁江面夜色」）、氛围光、留白供 UI overlay、「no text, no labels, no watermark, no UI」

### 角色立绘 `character`

- `imageSize`：**`1024x1024`**
- `path`：`src/assets/generated/char-{id}.ts`
- prompt 必含：姓名对应的历史/课文形象要点、半身或全身、居中、可抠图式简洁背景、与 `styleLock` 一致
- 蓝图：`"portraitAssetId": "char-liu"`

### 结局肖像 `endingPortrait`

- `imageSize`：**`1024x1024`**
- `path`：`src/assets/generated/ending-portrait.ts`
- 圆形头像友好：面部/上半身居中、高对比

### styleLock（先写后画）

在批量 `image.generate` **之前** 写入蓝图，并作为 **每条** prompt 的固定前缀。须与当次 `palette` 气质一致（把主色/点缀色感受写进文案，勿固定套句）。

写法：`{媒介与时代} + {与 palette 呼应的色感词} + {情绪/留白} + 无文字无水印`

示例（须按当次课文与 palette **改写**，非可复制模板）：

```
早期中国近代历史题材插画，略带油画与纸本感，复古军绿与暖赭点缀，庄重克制，人物神态坚毅清晰，无文字无水印，
```

```
水墨淡彩古典插画，宣纸质感，墨青与泥金点缀，意境留白，人物与景物清晰可读，无文字无水印，
```

```
童话水彩风，暖琥珀与奶油底色，柔和光晕，角色表情生动，无文字无水印，
```

同一 run 内所有 asset **共用同一 styleLock**。

### 生成顺序与门禁

1. 内容定稿 → 列出完整 `assets[]`（1 背景 + N 角色 + 1 结局肖像）
2. **批量** `image.generate`
3. 核对 mapped 齐全
4. 若 `audio.withSfx`：`sfx.map` → `ids` 取蓝图 `audio.sfxIds`
5. 若 `audio.dialogueSpeech !== "none"`：为标记 `speech: true` 或全部对白批量 `speech.generate`
6. 若 `audio.withEndingSpeech`：`speech.generate` 结局旁白 → `src/assets/generated/audio/ending-quote.ts`
7. **仅当配图就绪** 才写 React 组件

### 3. Art direction + AIGC

1. 填蓝图 `assets[]` + `styleLock`
2. 对每个 asset 调 `cli_execute` → `image.generate`：
   - `prompt` = `styleLock` + 专属描述
   - `path` = 蓝图中的 `path`
   - 尺寸按上节
3. 失败用 `cli_diagnose` 重试；**禁止**用 emoji/纯色/外链替代
4. 若 `audio.withSfx`：`cli_execute` → `sfx.map`：
   - `ids` = 蓝图 `audio.sfxIds`（默认 `["start","click","success","applause"]`）
5. 若 `audio.dialogueSpeech !== "none"`：对需朗读的对白逐条 `speech.generate`：
   - `input` = 去掉括号的台词
   - `speaker` = 说话角色 `characters[].voice`
   - `path` = 蓝图 `dialogues[].speechAssetPath`
6. 若 `audio.withEndingSpeech`：`cli_execute` → `speech.generate`：
   - `input` = `ending.quote`（可略加停顿标点）
   - `speaker`：旁白可用 `diana` / `charles`（与对白声线区分或统一，勿冲突）
   - `path`：`src/assets/generated/audio/ending-quote.ts`
7. 勿手写 SiliconFlow / 外链音频 URL

### 4. Implement（模块边界写死）

```
src/content/lesson-game-blueprint.json
src/content/lesson-game-data.ts
src/lib/lesson-game/state.ts
src/lib/lesson-game/audio.ts
src/components/lesson-game/Cover.tsx
src/components/lesson-game/Dialogue.tsx
src/components/lesson-game/Climax.tsx
src/components/lesson-game/Ending.tsx
src/App.tsx
```

- 可将蓝图 codegen 为 `lesson-game-data.ts` 供强类型导入
- 状态机 = 蓝图 `coreLoop`；场景切换用 React state（`scene: 'cover' | 'dialogue' | 'climax' | 'ending'`）
- **打字机**：用 `requestAnimationFrame` / 简单 interval，或 CSS；**不要**强绑 anime.js CDN
- **shake / 逐字浮现**：纯 CSS `@keyframes` 或少量 JS
- 配图：`import url from "../assets/generated/....ts"`；经 `portraitAssetId` / asset id 查表
- **音效**：`audio.ts` 导出 `playSfx(id)`，从 `src/assets/sfx/*.ts` import；按钮 `onClick` 内先 `playSfx` 再切状态
- **对白音频**：有 `speechAssetPath` 则打字机开始时播放，继续时停止；无则静默
- 结局音频：有 generated 模块则金句浮现后 `audio.play()`（catch 自动播放失败）；无则静默
- **禁止**主产物是带 `srcdoc` 的壳 HTML
- **禁止**依赖外链 CDN 脚本（Tailwind Play CDN、anime.js CDN）；**禁止**手写外链 mp3（须走 `sfx.map` / `speech.generate`）

### 5. Verify

1. `sandbox.typecheck`
2. `sandbox.getPreviewErrors`（`wait=true`）
3. 最终中文回复勾选：
   - 封面标题可读，「开始体验」可进对话
   - **背景与两名角色均为 generated 图**
   - 对话推进：说话者焦点切换 + 打字机 + 继续按钮
   - 对白结束后进入高潮；`click-meter` 可点满并进入结局
   - 结局金句逐字出现；有旁白则尝试播放；「再读一遍」可用
   - 封面/继续/高潮完成等按钮有对应音效（`withSfx` 时）；对白 `keyLines`/`all` 时有朗读
   - 移动端对话框与立绘不严重裁切
   - 无手写外链 CDN 脚本 / 无 `musk-online` 素材

---

## 蓝图 schema（最小）

下列示例为《军神》气质（复古绿）；**换课文时必须同步换对白、高潮语义，并重新自主设计 palette 与 styleLock**（勿复用示例 hex）。

```json
{
  "source": { "path": null, "title": "课文互动游戏：军神", "genre": "lesson-drama" },
  "reuse": {
    "coreLoop": ["cover", "dialogue", "climax", "ending", "replay"],
    "layout": "L3-lesson-drama",
    "palette": {
      "primary": "#2D593E",
      "secondary": "#EBEDD4",
      "accent": "#AE7645",
      "dark": "#1D422B"
    }
  },
  "intent": {
    "topic": "军神",
    "audience": "小学高年级语文",
    "tone": "庄重共情"
  },
  "audio": {
    "withSfx": true,
    "sfxIds": ["start", "click", "success", "applause"],
    "dialogueSpeech": "keyLines",
    "withEndingSpeech": true
  },
  "screens": ["cover", "dialogue", "climax", "ending"],
  "cover": {
    "title": "军神",
    "subtitle": "重返1916年，见证钢铁意志的诞生",
    "cta": "开始体验"
  },
  "characters": [
    {
      "id": "walker",
      "name": "沃克医生",
      "role": "deuteragonist",
      "voice": "david",
      "portraitAssetId": "char-walker"
    },
    {
      "id": "liu",
      "name": "刘伯承",
      "role": "protagonist",
      "voice": "charles",
      "portraitAssetId": "char-liu"
    }
  ],
  "dialogues": [
    {
      "speaker": "walker",
      "text": "（冷冷地）你叫什么名字？",
      "action": "normal"
    },
    {
      "speaker": "liu",
      "text": "刘大川。",
      "action": "calm",
      "speech": true,
      "speechAssetPath": "src/assets/generated/audio/dialogue-02.ts"
    }
  ],
  "climax": {
    "type": "click-meter",
    "title": "意志力的考验",
    "subtitle": "手术正在进行，请保持清醒...",
    "target": 72,
    "unitLabel": "刀",
    "buttonLabel": "坚持住！(点击)",
    "statusLines": [
      { "until": 20, "text": "额头上汗珠滚滚..." },
      { "until": 50, "text": "双手紧紧抓住床单..." },
      { "until": 70, "text": "床单被抓破了！" },
      { "until": 72, "text": "手术结束！" }
    ]
  },
  "ending": {
    "quote": "了不起！你是一个真正的男子汉，一块会说话的钢板！你是一位军神！",
    "portraitAssetId": "ending-portrait",
    "speechAssetPath": "src/assets/generated/audio/ending-quote.ts",
    "replayLabel": "再读一遍"
  },
  "assets": [
    {
      "id": "scene-bg",
      "role": "sceneBackground",
      "prompt": "1916年诊所室内，木质家具与手术台氛围，昏暖灯光，复古 greenery 色调，无文字",
      "path": "src/assets/generated/scene-bg.ts",
      "imageSize": "1792x1024"
    },
    {
      "id": "char-walker",
      "role": "character",
      "characterId": "walker",
      "prompt": "近代外国医生半身立绘，白大褂，严肃神情，居中，简洁背景",
      "path": "src/assets/generated/char-walker.ts",
      "imageSize": "1024x1024"
    },
    {
      "id": "char-liu",
      "role": "character",
      "characterId": "liu",
      "prompt": "青年军人半身立绘，坚毅从容，中式简装，居中，简洁背景",
      "path": "src/assets/generated/char-liu.ts",
      "imageSize": "1024x1024"
    },
    {
      "id": "ending-portrait",
      "role": "endingPortrait",
      "prompt": "青年军人面部特写，圆形构图友好，坚毅目光，庄重暖光",
      "path": "src/assets/generated/ending-portrait.ts",
      "imageSize": "1024x1024"
    }
  ],
  "styleLock": "早期中国近代历史题材插画，略带油画与纸本感，复古绿与暖赭点缀，庄重克制，人物神态坚毅清晰，无文字无水印，"
}
```

`assets[].role` 常用：`sceneBackground` | `character` | `endingPortrait`。

---

## Planner 建议步序

1. 从用户意图生成 `lesson-game-blueprint.json` 骨架（`source.path=null`，固定 L3-lesson-drama；**自主设计 palette**；写入 `audio` 块）
2. 填满 `characters` / `dialogues` / `climax` / `ending`；标记关键对白 `speech: true`；展开完整 `assets[]`
3. 写 `styleLock` → **批量 `image.generate`** → `sfx.map` → 按需批量 `speech.generate`（对白 + 结局）
4. 实现 `audio.ts` + Cover / Dialogue / Climax / Ending + state，接到 `App.tsx`
5. `typecheck` + `getPreviewErrors`
