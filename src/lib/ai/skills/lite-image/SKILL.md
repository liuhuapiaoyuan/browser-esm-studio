# Lite Image

## 适用场景

- 用户要文生图、图生图、插画、封面、UI 配图
- 需要把生成结果的 URL 映射进虚拟项目，供 Preview 引用

本技能由宿主在发送时加载，并依赖 Sandbox。所有绘图请求都必须通过 `cli_*` 调度 `image.*` 命令。

**Never** 在用户项目里手写 SiliconFlow / `images/generations` fetch。密钥与上游地址由宿主 Vite 反代（`/lite-image-proxy`）处理。

**Never** 下载图片或把 base64 / data URL 写入 sandbox（会撑爆 localStorage）。sandbox 只存 **path → URL** 映射。

---

## Agent CLI 调度

`cli_search` / `cli_describe` / `cli_diagnose` 是 **独立 meta-tool**，不要塞进 `cli_execute.command`。

1. 不确定命令名 → 直接调工具 `cli_search`，参数 `{ "query": "generate image" }`
2. 不确定参数 → 直接调工具 `cli_describe`，参数 `{ "command": "image.generate" }`
3. 执行 → 工具 `cli_execute`，参数 `{ "command": "image.generate", "arguments": { ... } }`
4. 失败 → 直接调工具 `cli_diagnose`（executionId）按结构化 recovery 处理

---

## 生成并映射 URL

```json
{
  "command": "image.generate",
  "arguments": {
    "prompt": "cozy cafe storefront illustration, flat vector, warm daylight",
    "path": "src/assets/generated/cafe-hero.ts"
  }
}
```

- 省略 `path` 时写入 `src/assets/generated/<slug>-<timestamp>.ts`
- 模块内容仅为 `export default "<url>"`（字符串，无图片字节）
- 同时更新 `src/assets/generated/manifest.json`：`{ "<path>": "<url>" }`
- 成功后看 **`mapped[].path`** / **`mapped[].url`** 与 **`hint`**

---

## 接入 UI

```typescript
import cafeHero from "./assets/generated/cafe-hero.ts";

<img src={cafeHero} alt="Cafe illustration" />
```

也可从 `manifest.json` 读 path→url。路径相对导入方调整；用 `sandbox.replaceInFile` 接到页面即可。

---

## 图生图 / 参考图

`image` / `image2` / `image3` 可传：

- sandbox 相对路径（`export default "<url>"` 模块）
- `https://...` 图 URL
- `data:image/...;base64,...`（仅作 API 入参，不要写回 sandbox）

---

## 常用参数

| 参数 | 说明 |
|------|------|
| prompt | 必填 |
| negativePrompt | 可选 |
| model | 默认 `Kwai-Kolors/Kolors` |
| imageSize | 默认 `1024x1024`；部分 Edit 模型不支持 |
| batchSize | Kolors 1–4；多图时 path 会自动加 `-1`/`-2` 后缀 |
| seed / numInferenceSteps / guidanceScale / cfg | 按模型可选 |

---

## 验证

- 生成后确认模块 / `manifest.json` 只有短 URL，没有 base64
- 接到 UI 后用 `sandbox.getPreviewErrors`（必要时 `wait=true`）检查 Preview
