import { z } from "zod";
import { defineCommand } from "../../../define-command";
import { listSfxIds } from "../catalog";
import { mapSfxIds, SFX_MANIFEST_PATH } from "../shared";

const idHint = listSfxIds().join(" | ");

export const sfxMap = defineCommand({
  metadata: {
    name: "sfx.map",
    version: "1.0.0",
    title: "映射教学音效",
    summary: "将内置音效 CDN URL 写入 sandbox 模块，供 Preview 播放",
    tags: ["sfx", "audio", "sound", "assets"],
    aliases: ["sound.map", "soundfx.map"],
  },
  agent: {
    purpose: "把选定的教学音效 URL 映射进虚拟项目，便于在按钮/判题/场景中播放",
    useWhen: [
      "互动页需要点击音、答对/答错、倒计时等音效",
      "已通过 sfx.list 选定 id",
    ],
    avoidWhen: ["需要 AI 合成讲解语音（用 speech.generate）"],
    instructions: [
      "成功后 import url from mapped.path，在事件里 new Audio(url).play().catch(() => {})",
      "按钮/选项统一用 click；判题用 correct/wrong；通关 success、失败 fail",
      "可一次映射多个：ids: [\"correct\",\"wrong\",\"click\"]，默认写到 src/assets/sfx/<id>.ts",
      "不要手写外链或下载 mp3 进 sandbox；一律走本命令",
    ],
    examples: [
      {
        userRequest: "给答题页加对错和点击音效",
        input: { ids: ["correct", "wrong", "click"] },
      },
      {
        userRequest: "倒计时结束音放到自定义路径",
        input: {
          ids: ["time-up"],
          paths: ["src/assets/sfx/timer-end.ts"],
        },
      },
    ],
  },
  inputSchema: z.object({
    ids: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .describe(`音效 id，可用：${idHint}`),
    paths: z
      .array(z.string().min(1))
      .optional()
      .describe("与 ids 等长的 sandbox 路径（.ts/.tsx），默认 src/assets/sfx/<id>.ts"),
  }),
  outputSchema: z.object({
    mapped: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        url: z.string(),
      }),
    ),
    manifestPath: z.string(),
    hint: z.string(),
    playSnippet: z.string(),
  }),
  execution: { timeoutMs: 10_000 },
  safety: { risk: "write", sideEffect: true, idempotent: true },
  recovery: {
    maxAutoRetries: 0,
    errors: {
      RESOURCE_NOT_FOUND: {
        description: "未知音效 id",
        retryable: false,
        suggestions: ["调用 sfx.list 查看可用 id"],
      },
    },
  },
  execute(input, ctx) {
    const mapped = mapSfxIds(ctx.sandbox, input.ids, input.paths);
    const first = mapped[0]!;
    const rel = first.path.replace(/^src\//, "");

    return {
      mapped,
      manifestPath: SFX_MANIFEST_PATH,
      hint: `Import: import ${first.id}Sfx from "./${rel}"; play with new Audio(${first.id}Sfx).play(). Also recorded in ${SFX_MANIFEST_PATH}.`,
      playSnippet: `function playSfx(url: string) {\n  const audio = new Audio(url);\n  audio.play().catch(() => {});\n}\n// e.g. playSfx(${first.id}Sfx);`,
    };
  },
});
