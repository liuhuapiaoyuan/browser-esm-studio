import type { AgentCliPlugin } from "../agent-cli";
import { imagePlugin } from "../agent-cli/plugins/image";
import { sfxPlugin } from "../agent-cli/plugins/sfx";
import { speechPlugin } from "../agent-cli/plugins/speech";

/** Always-on Agent CLI plugins (not skill-gated). */
export const DEFAULT_AGENT_PLUGINS: AgentCliPlugin[] = [imagePlugin, speechPlugin, sfxPlugin];

/**
 * Short CLI cheat-sheet injected into planner / executor sys-prompt.
 * Keep minimal — full schemas remain available via cli_describe.
 */
export function buildDefaultCapabilitiesPrompt(): string {
  return `## Built-in capabilities (always available)
These commands are always loaded for this run — not skill-gated. Call via \`cli_execute\` directly (do not invent SiliconFlow fetch in the project).

### image.generate — AI 配图
文生图 / 图生图。sandbox **只写 path→URL 映射**（不下载、不写 base64）。
\`\`\`
cli_execute → { "command": "image.generate", "arguments": {
  "prompt": "cozy cafe storefront illustration, flat vector, warm daylight",
  "path": "src/assets/generated/cafe-hero.ts"
}}
\`\`\`
成功后：\`import url from "./assets/generated/cafe-hero.ts"\` → \`<img src={url} alt="..." />\`
常用可选：\`negativePrompt\` · \`imageSize\`（默认 1024x1024）· \`image\` / \`image2\` / \`image3\`（参考图：sandbox 路径 | https | data URL）

### speech.generate — AI 语音合成
文本转语音（短句讲解）。sandbox 写 path→可播放 URL 映射。
\`\`\`
cli_execute → { "command": "speech.generate", "arguments": {
  "input": "欢迎来到本课，点击开始进入学习。",
  "speaker": "diana",
  "path": "src/assets/generated/audio/welcome.ts"
}}
\`\`\`
成功后：\`import url from "./assets/generated/audio/welcome.ts"\` → \`<audio src={url} controls />\`
常用可选：\`speaker\`（alex|anna|bella|benjamin|charles|claire|david|diana）· \`speed\`（0.25–4）· \`responseFormat\`（mp3|opus|wav|pcm）

### sfx.list / sfx.map — 教学互动音效
内置 20 种常用教学音效（CDN，无需下载）。先 \`sfx.list\` 查 id 与场景，再 \`sfx.map\` 写入 sandbox。
\`\`\`
cli_execute → { "command": "sfx.list", "arguments": { "category": "quiz" } }
cli_execute → { "command": "sfx.map", "arguments": {
  "ids": ["correct", "wrong", "click"]
}}
\`\`\`
成功后：\`import correctSfx from "./assets/sfx/correct.ts"\` → \`new Audio(correctSfx).play()\`
常用 id：\`correct\` 答对 · \`wrong\` 答错 · \`click\` 按钮 · \`success\` 通关 · \`fail\` 失败 · \`time-up\` 倒计时 · \`start\` 开始 · \`coin\` 得分
不确定参数时再用 \`cli_describe\`（command: image.generate / speech.generate / sfx.list / sfx.map）。`;
}

/** Merge always-on plugins with skill plugins; first registration wins on name. */
export function mergeAgentPlugins(
  defaults: readonly AgentCliPlugin[],
  fromSkills: readonly AgentCliPlugin[],
): AgentCliPlugin[] {
  const out: AgentCliPlugin[] = [];
  const versions = new Map<string, string>();
  for (const plugin of [...defaults, ...fromSkills]) {
    const registered = versions.get(plugin.name);
    if (registered && registered !== plugin.version) {
      throw new Error(
        `Agent CLI plugin 版本冲突: ${plugin.name} (${registered} / ${plugin.version})`,
      );
    }
    if (registered) continue;
    versions.set(plugin.name, plugin.version);
    out.push(plugin);
  }
  return out;
}
