import { z } from "zod";
import { defineCommand } from "../../../define-command";
import { SFX_CATALOG } from "../catalog";

export const sfxList = defineCommand({
  metadata: {
    name: "sfx.list",
    version: "1.0.0",
    title: "教学音效目录",
    summary: "列出内置教学互动音效（CDN URL + 适用场景）",
    tags: ["sfx", "audio", "sound", "catalog"],
    aliases: ["sound.list", "soundfx.list"],
  },
  agent: {
    purpose: "在写互动页面前了解有哪些现成音效、各自适用场景",
    useWhen: [
      "需要给按钮、判题、闯关、倒计时等加音效",
      "不确定该用哪个音效 id",
    ],
    avoidWhen: ["用户明确只要 TTS 讲解（用 speech.generate）"],
    instructions: [
      "选音效后调用 sfx.map 写入 sandbox URL 模块，再在组件里 new Audio(url).play()",
      "常用组合：答题页 correct+wrong+click；闯关 start+success+fail+level-up；倒计时 time-up+warning",
    ],
    examples: [
      {
        userRequest: "看看有哪些答题音效",
        input: { category: "quiz" },
      },
    ],
  },
  inputSchema: z.object({
    category: z
      .enum(["all", "quiz", "game", "ui", "narrative"])
      .optional()
      .describe("筛选类别，默认 all"),
  }),
  outputSchema: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        url: z.string(),
        scenes: z.array(z.string()),
      }),
    ),
    hint: z.string(),
  }),
  execution: { timeoutMs: 5_000 },
  safety: { risk: "read", sideEffect: false, idempotent: true },
  execute(input) {
    const category = input.category ?? "all";
    const quizIds = new Set(["correct", "wrong", "fail", "success", "cheer", "oops", "question", "thinking"]);
    const gameIds = new Set(["start", "pause", "level-up", "coin", "time-up", "fail", "success", "cheer"]);
    const uiIds = new Set(["click", "ding", "got-it", "warning", "knock"]);
    const narrativeIds = new Set(["applause", "goodbye", "thinking", "question", "knock"]);

    const filterByCategory = (id: string): boolean => {
      if (category === "all") return true;
      if (category === "quiz") return quizIds.has(id);
      if (category === "game") return gameIds.has(id);
      if (category === "ui") return uiIds.has(id);
      if (category === "narrative") return narrativeIds.has(id);
      return true;
    };

    const items = SFX_CATALOG.filter((entry) => filterByCategory(entry.id)).map(
      ({ id, name, icon, url, scenes }) => ({ id, name, icon, url, scenes }),
    );

    return {
      count: items.length,
      items,
      hint:
        "选定 id 后调用 sfx.map（如 ids: [\"correct\",\"wrong\",\"click\"]），再在代码中 import url 并用 new Audio(url).play()。",
    };
  },
});
