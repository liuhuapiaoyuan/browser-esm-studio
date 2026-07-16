import assert from "node:assert/strict";
import { createAgentCliRuntime } from "../src/lib/agent-cli/index.ts";
import {
  buildDefaultCapabilitiesPrompt,
  DEFAULT_AGENT_PLUGINS,
  mergeAgentPlugins,
} from "../src/lib/ai/default-capabilities.ts";
import {
  buildSkillsPromptSection,
  defaultSkillIds,
  listSkills,
  resolveSkills,
} from "../src/lib/ai/skills/registry.ts";
import { createSandbox } from "../src/lib/sandbox.ts";

const catalog = listSkills();
assert.deepEqual(
  catalog.map((skill) => skill.id),
  [
    "sandbox",
    "dynamic-db",
    "interactive-quest",
    "quest-learning",
    "panorama-showcase",
    "slide-courseware",
    "text-interactive-game",
    "usage-tracking",
  ],
);
assert.deepEqual(defaultSkillIds(), ["sandbox", "dynamic-db"]);
assert.equal(
  catalog.find((skill) => skill.id === "interactive-quest")?.defaultEnabled,
  false,
);
assert.ok(catalog.every((skill) => !("body" in skill) && !("plugins" in skill)));
assert.ok(
  catalog.every(
    (skill) =>
      typeof skill.icon === "string" &&
      skill.icon.startsWith("https://") &&
      typeof skill.motto === "string" &&
      skill.motto.length > 0,
  ),
);

const empty = resolveSkills([]);
assert.deepEqual(empty.requestedIds, []);
assert.deepEqual(empty.activeIds, []);
assert.deepEqual(empty.plugins, []);
assert.match(buildSkillsPromptSection(empty), /No Agent CLI skill is loaded/);
assert.doesNotMatch(buildSkillsPromptSection(empty), /<skill /);

// Removed skill ids are ignored (old chat follow-ups).
assert.deepEqual(resolveSkills(["lite-image"]).activeIds, []);
assert.deepEqual(resolveSkills(["sandbox", "lite-image"]).activeIds, ["sandbox"]);

const builtins = buildDefaultCapabilitiesPrompt();
assert.match(builtins, /image\.generate/);
assert.match(builtins, /speech\.generate/);
assert.match(builtins, /sfx\.map/);
assert.match(builtins, /Built-in capabilities/);
assert.deepEqual(
  DEFAULT_AGENT_PLUGINS.map((plugin) => plugin.name),
  ["@agent-cli/plugin-image", "@agent-cli/plugin-speech", "@agent-cli/plugin-sfx"],
);

const sandboxOnly = resolveSkills(["sandbox"]);
assert.deepEqual(sandboxOnly.activeIds, ["sandbox"]);
assert.deepEqual(
  sandboxOnly.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const sandboxPrompt = buildSkillsPromptSection(sandboxOnly);
assert.match(sandboxPrompt, /<skill id="sandbox"/);
assert.doesNotMatch(sandboxPrompt, /<skill id="dynamic-db"/);
assert.doesNotMatch(sandboxPrompt, /ddb\.setupSchema/);
assert.doesNotMatch(sandboxPrompt, /<skill id="lite-image"/);

const dynamicDb = resolveSkills(["dynamic-db"]);
assert.deepEqual(dynamicDb.requestedIds, ["dynamic-db"]);
assert.deepEqual(dynamicDb.activeIds, ["sandbox", "dynamic-db"]);
assert.deepEqual(dynamicDb.requiredBy.sandbox, ["dynamic-db"]);
assert.deepEqual(
  dynamicDb.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-ddb"],
);

const reversed = resolveSkills(["dynamic-db", "sandbox"]);
assert.deepEqual(reversed.requestedIds, ["sandbox", "dynamic-db"]);
assert.deepEqual(reversed.activeIds, dynamicDb.activeIds);
assert.equal(
  buildSkillsPromptSection(reversed),
  buildSkillsPromptSection(resolveSkills(["sandbox", "dynamic-db"])),
);

const dynamicPrompt = buildSkillsPromptSection(dynamicDb);
assert.match(dynamicPrompt, /<skill id="sandbox"/);
assert.match(dynamicPrompt, /<skill id="dynamic-db"/);
assert.ok(dynamicPrompt.indexOf('<skill id="sandbox"') < dynamicPrompt.indexOf('<skill id="dynamic-db"'));

const interactiveQuest = resolveSkills(["interactive-quest"]);
assert.deepEqual(interactiveQuest.requestedIds, ["interactive-quest"]);
assert.deepEqual(interactiveQuest.activeIds, ["sandbox", "interactive-quest"]);
assert.deepEqual(interactiveQuest.requiredBy.sandbox, ["interactive-quest"]);
assert.deepEqual(
  interactiveQuest.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const questPrompt = buildSkillsPromptSection(interactiveQuest);
assert.match(questPrompt, /<skill id="interactive-quest"/);
assert.match(questPrompt, /quest-blueprint\.json/);
assert.match(questPrompt, /image\.generate/);
assert.doesNotMatch(questPrompt, /<skill id="dynamic-db"/);
assert.doesNotMatch(questPrompt, /<skill id="lite-image"/);

const questLearning = resolveSkills(["quest-learning"]);
assert.deepEqual(questLearning.requestedIds, ["quest-learning"]);
assert.deepEqual(questLearning.activeIds, ["sandbox", "quest-learning"]);
assert.deepEqual(questLearning.requiredBy.sandbox, ["quest-learning"]);
assert.deepEqual(
  questLearning.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const learningPrompt = buildSkillsPromptSection(questLearning);
assert.match(learningPrompt, /<skill id="quest-learning"/);
assert.match(learningPrompt, /L1-map/);
assert.match(learningPrompt, /mapBackground/);
assert.match(learningPrompt, /levelIcon/);
assert.match(learningPrompt, /1792x1024/);
assert.match(learningPrompt, /source\.path=null|path\": null/);
assert.doesNotMatch(learningPrompt, /<skill id="interactive-quest"/);
assert.doesNotMatch(learningPrompt, /<skill id="lite-image"/);

const panoramaShowcase = resolveSkills(["panorama-showcase"]);
assert.deepEqual(panoramaShowcase.requestedIds, ["panorama-showcase"]);
assert.deepEqual(panoramaShowcase.activeIds, ["sandbox", "panorama-showcase"]);
assert.deepEqual(panoramaShowcase.requiredBy.sandbox, ["panorama-showcase"]);
assert.deepEqual(
  panoramaShowcase.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const panoramaPrompt = buildSkillsPromptSection(panoramaShowcase);
assert.match(panoramaPrompt, /<skill id="panorama-showcase"/);
assert.match(panoramaPrompt, /L2-panorama/);
assert.match(panoramaPrompt, /stageCover/);
assert.match(panoramaPrompt, /panorama-blueprint\.json/);
assert.match(panoramaPrompt, /source\.path=null|path\": null/);
assert.doesNotMatch(panoramaPrompt, /<skill id="quest-learning"/);
assert.doesNotMatch(panoramaPrompt, /<skill id="interactive-quest"/);
assert.doesNotMatch(panoramaPrompt, /<skill id="lite-image"/);

const slideCourseware = resolveSkills(["slide-courseware"]);
assert.deepEqual(slideCourseware.requestedIds, ["slide-courseware"]);
assert.deepEqual(slideCourseware.activeIds, ["sandbox", "slide-courseware"]);
assert.deepEqual(slideCourseware.requiredBy.sandbox, ["slide-courseware"]);
assert.deepEqual(
  slideCourseware.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const slidesPrompt = buildSkillsPromptSection(slideCourseware);
assert.match(slidesPrompt, /<skill id="slide-courseware"/);
assert.match(slidesPrompt, /L4-slides/);
assert.match(slidesPrompt, /slides-blueprint\.json/);
assert.match(slidesPrompt, /outlineConfirm/);
assert.match(slidesPrompt, /coverHero/);
assert.match(slidesPrompt, /source\.path=null|path\": null/);
assert.doesNotMatch(slidesPrompt, /<skill id="quest-learning"/);
assert.doesNotMatch(slidesPrompt, /<skill id="panorama-showcase"/);
assert.doesNotMatch(slidesPrompt, /<skill id="lite-image"/);

const textInteractiveGame = resolveSkills(["text-interactive-game"]);
assert.deepEqual(textInteractiveGame.requestedIds, ["text-interactive-game"]);
assert.deepEqual(textInteractiveGame.activeIds, ["sandbox", "text-interactive-game"]);
assert.deepEqual(textInteractiveGame.requiredBy.sandbox, ["text-interactive-game"]);
assert.deepEqual(
  textInteractiveGame.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox"],
);
const lessonGamePrompt = buildSkillsPromptSection(textInteractiveGame);
assert.match(lessonGamePrompt, /<skill id="text-interactive-game"/);
assert.match(lessonGamePrompt, /L3-lesson-drama/);
assert.match(lessonGamePrompt, /lesson-game-blueprint\.json/);
assert.match(lessonGamePrompt, /click-meter/);
assert.match(lessonGamePrompt, /source\.path=null|path\": null/);
assert.doesNotMatch(lessonGamePrompt, /<skill id="quest-learning"/);
assert.doesNotMatch(lessonGamePrompt, /<skill id="panorama-showcase"/);
assert.doesNotMatch(lessonGamePrompt, /<skill id="lite-image"/);

const usageTracking = resolveSkills(["usage-tracking"]);
assert.deepEqual(usageTracking.requestedIds, ["usage-tracking"]);
assert.deepEqual(usageTracking.activeIds, ["sandbox", "dynamic-db", "usage-tracking"]);
assert.deepEqual(usageTracking.requiredBy.sandbox, ["dynamic-db", "usage-tracking"]);
assert.deepEqual(usageTracking.requiredBy["dynamic-db"], ["usage-tracking"]);
assert.deepEqual(
  usageTracking.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-ddb"],
);
const usagePrompt = buildSkillsPromptSection(usageTracking);
assert.match(usagePrompt, /<skill id="usage-tracking"/);
assert.match(usagePrompt, /studentPasscode/);
assert.match(usagePrompt, /teacherPasscode/);
assert.match(usagePrompt, /usage-tracking\.json/);
assert.match(usagePrompt, /必须反问/);
assert.doesNotMatch(usagePrompt, /<skill id="lite-image"/);
assert.doesNotMatch(usagePrompt, /<skill id="quest-learning"/);

assert.throws(() => resolveSkills(["not-installed"]), /未知 skill/);

const sandbox = createSandbox({
  "index.html": "<!doctype html>",
  "package.json": "{}",
  "src/index.ts": "export {};\n",
});
const runtimeFor = (ids) => {
  const resolved = resolveSkills(ids);
  return createAgentCliRuntime({
    plugins: mergeAgentPlugins(DEFAULT_AGENT_PLUGINS, resolved.plugins),
    context: { sandbox, previewConsole: { getErrors: () => [] } },
  });
};

const noSkillRuntime = runtimeFor([]);
assert.ok(noSkillRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(noSkillRuntime.list().some((command) => command.name === "speech.generate"));
assert.ok(noSkillRuntime.list().some((command) => command.name === "sfx.list"));
assert.ok(noSkillRuntime.list().some((command) => command.name === "sfx.map"));
assert.equal((await noSkillRuntime.execute("sandbox.listFiles", {})).error?.code, "COMMAND_NOT_FOUND");
assert.equal((await noSkillRuntime.execute("ddb.getSchema", {})).error?.code, "COMMAND_NOT_FOUND");

const sandboxRuntime = runtimeFor(["sandbox"]);
assert.ok(sandboxRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(sandboxRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(sandboxRuntime.list().some((command) => command.name === "speech.generate"));
assert.equal(sandboxRuntime.list().some((command) => command.name.startsWith("ddb.")), false);

const dynamicRuntime = runtimeFor(["dynamic-db"]);
assert.ok(dynamicRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(dynamicRuntime.list().some((command) => command.name === "ddb.getSchema"));
assert.ok(dynamicRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(dynamicRuntime.list().some((command) => command.name === "speech.generate"));

const questRuntime = runtimeFor(["interactive-quest"]);
assert.ok(questRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(questRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(questRuntime.list().some((command) => command.name === "speech.generate"));
assert.equal(questRuntime.list().some((command) => command.name.startsWith("ddb.")), false);

const questLearningRuntime = runtimeFor(["quest-learning"]);
assert.ok(questLearningRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(questLearningRuntime.list().some((command) => command.name === "image.generate"));

const panoramaRuntime = runtimeFor(["panorama-showcase"]);
assert.ok(panoramaRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(panoramaRuntime.list().some((command) => command.name === "image.generate"));

const lessonGameRuntime = runtimeFor(["text-interactive-game"]);
assert.ok(lessonGameRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(lessonGameRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(lessonGameRuntime.list().some((command) => command.name === "speech.generate"));

const usageRuntime = runtimeFor(["usage-tracking"]);
assert.ok(usageRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(usageRuntime.list().some((command) => command.name === "ddb.getSchema"));
assert.ok(usageRuntime.list().some((command) => command.name === "image.generate"));
assert.ok(usageRuntime.list().some((command) => command.name === "speech.generate"));

const { IMAGE_MANIFEST_PATH, mapGeneratedImages, resolveImageRef } = await import(
  "../src/lib/agent-cli/plugins/image/shared.ts"
);
const mapped = mapGeneratedImages(
  sandbox,
  { images: [{ url: "https://example.test/a.png" }], seed: 1 },
  { prompt: "tiny red pixel", path: "src/assets/generated/smoke-pixel.ts" },
);
assert.equal(mapped.length, 1);
assert.equal(mapped[0].path, "src/assets/generated/smoke-pixel.ts");
assert.equal(mapped[0].url, "https://example.test/a.png");
assert.match(sandbox.read(mapped[0].path), /export default "https:\/\/example\.test\/a\.png"/);
assert.doesNotMatch(sandbox.read(mapped[0].path), /base64/);
assert.equal(resolveImageRef(sandbox, mapped[0].path), "https://example.test/a.png");
const manifest = JSON.parse(sandbox.read(IMAGE_MANIFEST_PATH));
assert.equal(manifest[mapped[0].path], "https://example.test/a.png");

const {
  SPEECH_MANIFEST_PATH,
  mapGeneratedSpeech,
} = await import("../src/lib/agent-cli/plugins/speech/shared.ts");
const tinyMp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]).buffer;
const speechMapped = mapGeneratedSpeech(
  sandbox,
  {
    audio: tinyMp3,
    blob: new Blob([tinyMp3], { type: "audio/mpeg" }),
    mimeType: "audio/mpeg",
    responseFormat: "mp3",
    model: "FunAudioLLM/CosyVoice2-0.5B",
    voice: "FunAudioLLM/CosyVoice2-0.5B:alex",
  },
  { input: "你好", path: "src/assets/generated/audio/smoke-hi.ts" },
);
assert.equal(speechMapped.path, "src/assets/generated/audio/smoke-hi.ts");
assert.match(speechMapped.url, /^data:audio\/mpeg;base64,/);
assert.match(sandbox.read(speechMapped.path), /export default "data:audio\/mpeg;base64,/);
const speechManifest = JSON.parse(sandbox.read(SPEECH_MANIFEST_PATH));
assert.equal(speechManifest[speechMapped.path], speechMapped.url);

const { SFX_MANIFEST_PATH, mapSfxIds } = await import(
  "../src/lib/agent-cli/plugins/sfx/shared.ts"
);
const sfxMapped = mapSfxIds(sandbox, ["correct", "wrong", "click"]);
assert.equal(sfxMapped.length, 3);
assert.equal(sfxMapped[0].path, "src/assets/sfx/correct.ts");
assert.equal(sfxMapped[0].url, "https://cdn.qxai666.com/sfx/teaching/correct.mp3");
assert.match(sandbox.read(sfxMapped[0].path), /export default "https:\/\/cdn\.qxai666\.com\/sfx\/teaching\/correct\.mp3"/);
assert.doesNotMatch(sandbox.read(sfxMapped[0].path), /base64/);
const sfxManifest = JSON.parse(sandbox.read(SFX_MANIFEST_PATH));
assert.equal(sfxManifest[sfxMapped[0].path], sfxMapped[0].url);
assert.equal(sfxManifest["id:correct"], sfxMapped[0].url);

const sfxListResult = await noSkillRuntime.execute("sfx.list", { category: "quiz" });
assert.equal(sfxListResult.ok, true);
assert.ok((sfxListResult.data?.count ?? 0) >= 5);
assert.ok(sfxListResult.data?.items.some((item) => item.id === "correct"));

const {
  buildReferencePath,
  importReferenceHtml,
  listReferenceHtmlPaths,
} = await import("../src/lib/reference-html.ts");
assert.equal(buildReferencePath("五年级作文.html"), "references/五年级作文.html");
assert.equal(buildReferencePath("bad name!!.HTM"), "references/bad_name_.HTM");
const refSandbox = createSandbox({
  "index.html": "<!doctype html>",
  "package.json": "{}",
});
const imported = importReferenceHtml(refSandbox, "demo.html", "<html>ref</html>");
assert.equal(imported.ok, true);
if (imported.ok) {
  assert.equal(imported.path, "references/demo.html");
  assert.equal(refSandbox.read(imported.path), "<html>ref</html>");
}
assert.deepEqual(listReferenceHtmlPaths(refSandbox), ["references/demo.html"]);
const blocked = importReferenceHtml(refSandbox, "demo.html", "x", { overwrite: false });
assert.equal(blocked.ok, false);

console.log("Skills smoke test passed.");
