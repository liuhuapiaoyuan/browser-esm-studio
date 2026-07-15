import { z } from "zod";
import {
  generateLiteImage,
  LITE_IMAGE_DEFAULT_IMAGE_SIZE,
  LITE_IMAGE_DEFAULT_MODEL,
  resolveLiteImageConfig,
} from "../../../../../service/lite-image-generate";
import { defineCommand } from "../../../define-command";
import {
  IMAGE_MANIFEST_PATH,
  mapGeneratedImages,
  mapLiteImageError,
  resolveImageRef,
} from "../shared";

const imageSizeSchema = z
  .string()
  .optional()
  .describe(
    `Image size widthxheight (default ${LITE_IMAGE_DEFAULT_IMAGE_SIZE}). Not supported by Qwen-Image-Edit models.`,
  );

export const imageGenerate = defineCommand({
  metadata: {
    name: "image.generate",
    version: "1.1.0",
    title: "文生图 / 图生图",
    summary:
      "调用 SiliconFlow 生成图片，仅在 sandbox 写入 path→URL 映射（不下载、不写 base64）",
    tags: ["image", "generate", "assets", "kolors"],
    aliases: ["liteImage.generate", "img.generate"],
  },
  agent: {
    purpose: "为虚拟项目生成插图 / 英雄图 / UI 素材，并把 URL 映射进项目",
    useWhen: [
      "用户要画图、生成配图、插画、封面、图标位图",
      "需要把生成结果的 URL 接到 Preview",
    ],
    avoidWhen: ["只需改已有 SVG/CSS，无需位图生成"],
    instructions: [
      "成功后用 mapped[].path / mapped[].url：import url from '...'; <img src={url} />",
      "sandbox 只存 URL 映射，绝不下载图片或写入 base64（会撑爆 localStorage）",
      "参考图可传 sandbox 相对路径（export default URL 模块）或 https / data URL",
      "不要在用户项目里手写 SiliconFlow fetch；一律走本命令",
    ],
    examples: [
      {
        userRequest: "画一张咖啡馆招牌插画放到首页",
        input: {
          prompt: "cozy cafe storefront illustration, flat vector, warm daylight",
          path: "src/assets/generated/cafe-hero.ts",
        },
      },
    ],
  },
  inputSchema: z.object({
    prompt: z.string().min(1).describe("Text prompt for image generation"),
    negativePrompt: z.string().optional().describe("Negative prompt"),
    model: z
      .string()
      .optional()
      .describe(`Model id (default ${LITE_IMAGE_DEFAULT_MODEL})`),
    imageSize: imageSizeSchema,
    batchSize: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Output count for Kolors only (1–4)"),
    seed: z.number().int().min(0).max(9_999_999_999).optional(),
    numInferenceSteps: z.number().int().min(1).max(100).optional(),
    guidanceScale: z.number().min(0).max(20).optional().describe("Kolors guidance"),
    cfg: z.number().min(0.1).max(20).optional().describe("Qwen-Image CFG"),
    image: z
      .string()
      .optional()
      .describe("Reference image: sandbox path, https URL, or data URL"),
    image2: z.string().optional().describe("Reference image 2 (Qwen-Image-Edit-2509)"),
    image3: z.string().optional().describe("Reference image 3 (Qwen-Image-Edit-2509)"),
    path: z
      .string()
      .optional()
      .describe(
        "Sandbox .ts/.tsx path for the URL module (default src/assets/generated/<slug>-<stamp>.ts)",
      ),
  }),
  outputSchema: z.object({
    model: z.string(),
    seed: z.number().optional(),
    traceId: z.string().nullable().optional(),
    timings: z.object({ inference: z.number().optional() }).optional(),
    mapped: z.array(
      z.object({
        path: z.string(),
        url: z.string(),
      }),
    ),
    manifestPath: z.string(),
    hint: z.string(),
  }),
  execution: { timeoutMs: 120_000 },
  safety: { risk: "write", sideEffect: true, idempotent: false },
  recovery: {
    maxAutoRetries: 1,
    errors: {
      AUTH_REQUIRED: {
        description: "缺少 SiliconFlow API Key 或代理未注入 Authorization",
        retryable: false,
        suggestions: [
          "在项目根 .env 设置 LITE_IMAGE_API_KEY（或 SILICONFLOW_API_KEY）后重启 dev server",
        ],
      },
      RATE_LIMITED: {
        description: "上游限流",
        retryable: true,
        suggestions: ["稍后再试，或减小 batchSize"],
      },
    },
  },
  async execute(input, ctx) {
    try {
      const image = resolveImageRef(ctx.sandbox, input.image);
      const image2 = resolveImageRef(ctx.sandbox, input.image2);
      const image3 = resolveImageRef(ctx.sandbox, input.image3);

      const { model } = resolveLiteImageConfig({ model: input.model });
      const result = await generateLiteImage({
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        model,
        imageSize: input.imageSize,
        batchSize: input.batchSize,
        seed: input.seed,
        numInferenceSteps: input.numInferenceSteps,
        guidanceScale: input.guidanceScale,
        cfg: input.cfg,
        image,
        image2,
        image3,
      });

      const mapped = mapGeneratedImages(ctx.sandbox, result, {
        prompt: input.prompt,
        path: input.path,
      });

      const primaryPath = mapped[0]?.path;
      const hint = primaryPath
        ? `Import URL mapping: import img from "./${primaryPath.replace(/^src\//, "")}"; then <img src={img} alt="..." />. Also recorded in ${IMAGE_MANIFEST_PATH}.`
        : `Mapped URLs recorded in ${IMAGE_MANIFEST_PATH}.`;

      return {
        model,
        seed: result.seed,
        traceId: result.traceId,
        timings: result.timings,
        mapped,
        manifestPath: IMAGE_MANIFEST_PATH,
        hint,
      };
    } catch (e) {
      mapLiteImageError(e);
    }
  },
});
