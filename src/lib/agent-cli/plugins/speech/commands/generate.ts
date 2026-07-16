import { z } from "zod";
import {
  generateLiteSpeech,
  LITE_SPEECH_DEFAULT_MODEL,
  LITE_SPEECH_DEFAULT_SPEAKER,
  LITE_SPEECH_SPEAKERS,
  resolveLiteSpeechConfig,
} from "../../../../../service/lite-speech-generate";
import { defineCommand } from "../../../define-command";
import {
  mapGeneratedSpeech,
  mapLiteSpeechError,
  SPEECH_MANIFEST_PATH,
} from "../shared";

const speakerHint = LITE_SPEECH_SPEAKERS.join(" | ");

export const speechGenerate = defineCommand({
  metadata: {
    name: "speech.generate",
    version: "1.0.0",
    title: "文本转语音",
    summary:
      "调用 SiliconFlow TTS 合成语音，在 sandbox 写入 path→音频 URL 映射（短句讲解）",
    tags: ["speech", "tts", "audio", "generate"],
    aliases: ["liteSpeech.generate", "tts.generate"],
  },
  agent: {
    purpose: "为课件生成短句讲解 / 提示音，并把可播放 URL 映射进虚拟项目",
    useWhen: [
      "用户要配音、朗读、语音讲解、TTS",
      "需要把合成音频接到 Preview 的 <audio>",
    ],
    avoidWhen: ["只需改文案、无需真实音频"],
    instructions: [
      "成功后用 mapped.path / mapped.url：import url from '...'; <audio src={url} controls />",
      "适合短句/短段；过长文本会导致模块过大",
      "不要在用户项目里手写 SiliconFlow /audio/speech fetch；一律走本命令",
    ],
    examples: [
      {
        userRequest: "给欢迎页加一句女声讲解",
        input: {
          input: "欢迎来到本课，点击开始进入学习。",
          speaker: "diana",
          path: "src/assets/generated/audio/welcome.ts",
        },
      },
    ],
  },
  inputSchema: z.object({
    input: z.string().min(1).max(2000).describe("待合成文本（建议短句/短段）"),
    model: z
      .string()
      .optional()
      .describe(`Model id (default ${LITE_SPEECH_DEFAULT_MODEL})`),
    speaker: z
      .string()
      .optional()
      .describe(`说话人短名（default ${LITE_SPEECH_DEFAULT_SPEAKER}）：${speakerHint}`),
    voice: z
      .string()
      .optional()
      .describe("完整 voice，如 FunAudioLLM/CosyVoice2-0.5B:diana（优先于 speaker）"),
    responseFormat: z
      .enum(["mp3", "opus", "wav", "pcm"])
      .optional()
      .describe("输出格式，默认 mp3"),
    speed: z.number().min(0.25).max(4).optional().describe("语速 0.25–4，默认 1"),
    gain: z.number().min(-10).max(10).optional().describe("增益 -10–10，默认 0"),
    sampleRate: z.number().int().positive().optional(),
    path: z
      .string()
      .optional()
      .describe(
        "Sandbox .ts/.tsx path for the URL module (default src/assets/generated/audio/<slug>-<stamp>.ts)",
      ),
  }),
  outputSchema: z.object({
    model: z.string(),
    voice: z.string().optional(),
    responseFormat: z.string(),
    mimeType: z.string(),
    byteLength: z.number(),
    traceId: z.string().nullable().optional(),
    mapped: z.object({
      path: z.string(),
      url: z.string(),
    }),
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
        suggestions: ["稍后再试，或缩短 input"],
      },
      OUTPUT_TOO_LARGE: {
        description: "音频过大，不宜写入 sandbox",
        retryable: true,
        suggestions: ["缩短合成文本"],
      },
    },
  },
  async execute(input, ctx) {
    try {
      const { model, speaker } = resolveLiteSpeechConfig({
        model: input.model,
        speaker: input.speaker,
      });
      const result = await generateLiteSpeech({
        input: input.input,
        model,
        speaker,
        voice: input.voice,
        responseFormat: input.responseFormat,
        speed: input.speed,
        gain: input.gain,
        sampleRate: input.sampleRate,
      });

      const mapped = mapGeneratedSpeech(ctx.sandbox, result, {
        input: input.input,
        path: input.path,
      });

      return {
        model: result.model,
        voice: result.voice,
        responseFormat: result.responseFormat,
        mimeType: result.mimeType,
        byteLength: result.audio.byteLength,
        traceId: result.traceId,
        mapped,
        manifestPath: SPEECH_MANIFEST_PATH,
        hint: `Import URL mapping: import audio from "./${mapped.path.replace(/^src\//, "")}"; then <audio src={audio} controls />. Also recorded in ${SPEECH_MANIFEST_PATH}.`,
      };
    } catch (e) {
      mapLiteSpeechError(e);
    }
  },
});
