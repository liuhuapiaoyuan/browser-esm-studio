import assert from "node:assert/strict";
import { createAgentCliRuntime } from "../src/lib/agent-cli/index.ts";
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
  ["sandbox", "dynamic-db", "lite-image", "interactive-quest", "quest-learning"],
);
assert.deepEqual(defaultSkillIds(), ["sandbox", "dynamic-db", "lite-image"]);
assert.equal(
  catalog.find((skill) => skill.id === "interactive-quest")?.defaultEnabled,
  false,
);
assert.ok(catalog.every((skill) => !("body" in skill) && !("plugins" in skill)));

const empty = resolveSkills([]);
assert.deepEqual(empty.requestedIds, []);
assert.deepEqual(empty.activeIds, []);
assert.deepEqual(empty.plugins, []);
assert.match(buildSkillsPromptSection(empty), /No Agent CLI skill is loaded/);
assert.doesNotMatch(buildSkillsPromptSection(empty), /<skill /);

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
assert.doesNotMatch(sandboxPrompt, /image\.generate/);

const dynamicDb = resolveSkills(["dynamic-db"]);
assert.deepEqual(dynamicDb.requestedIds, ["dynamic-db"]);
assert.deepEqual(dynamicDb.activeIds, ["sandbox", "dynamic-db"]);
assert.deepEqual(dynamicDb.requiredBy.sandbox, ["dynamic-db"]);
assert.deepEqual(
  dynamicDb.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-ddb"],
);

const liteImage = resolveSkills(["lite-image"]);
assert.deepEqual(liteImage.requestedIds, ["lite-image"]);
assert.deepEqual(liteImage.activeIds, ["sandbox", "lite-image"]);
assert.deepEqual(liteImage.requiredBy.sandbox, ["lite-image"]);
assert.deepEqual(
  liteImage.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-image"],
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

const litePrompt = buildSkillsPromptSection(liteImage);
assert.match(litePrompt, /<skill id="lite-image"/);
assert.match(litePrompt, /image\.generate/);

const interactiveQuest = resolveSkills(["interactive-quest"]);
assert.deepEqual(interactiveQuest.requestedIds, ["interactive-quest"]);
assert.deepEqual(interactiveQuest.activeIds, ["sandbox", "lite-image", "interactive-quest"]);
assert.deepEqual(interactiveQuest.requiredBy.sandbox, ["lite-image", "interactive-quest"]);
assert.deepEqual(interactiveQuest.requiredBy["lite-image"], ["interactive-quest"]);
assert.deepEqual(
  interactiveQuest.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-image"],
);
const questPrompt = buildSkillsPromptSection(interactiveQuest);
assert.match(questPrompt, /<skill id="interactive-quest"/);
assert.match(questPrompt, /quest-blueprint\.json/);
assert.match(questPrompt, /image\.generate/);
assert.doesNotMatch(questPrompt, /<skill id="dynamic-db"/);

const questLearning = resolveSkills(["quest-learning"]);
assert.deepEqual(questLearning.requestedIds, ["quest-learning"]);
assert.deepEqual(questLearning.activeIds, ["sandbox", "lite-image", "quest-learning"]);
assert.deepEqual(questLearning.requiredBy.sandbox, ["lite-image", "quest-learning"]);
assert.deepEqual(questLearning.requiredBy["lite-image"], ["quest-learning"]);
assert.deepEqual(
  questLearning.plugins.map((plugin) => plugin.name),
  ["@agent-cli/plugin-sandbox", "@agent-cli/plugin-image"],
);
const learningPrompt = buildSkillsPromptSection(questLearning);
assert.match(learningPrompt, /<skill id="quest-learning"/);
assert.match(learningPrompt, /L1-map/);
assert.match(learningPrompt, /mapBackground/);
assert.match(learningPrompt, /levelIcon/);
assert.match(learningPrompt, /1792x1024/);
assert.match(learningPrompt, /source\.path=null|path\": null/);
assert.doesNotMatch(learningPrompt, /<skill id="interactive-quest"/);

assert.throws(() => resolveSkills(["not-installed"]), /未知 skill/);

const sandbox = createSandbox({
  "index.html": "<!doctype html>",
  "package.json": "{}",
  "src/index.ts": "export {};\n",
});
const runtimeFor = (ids) => {
  const resolved = resolveSkills(ids);
  return createAgentCliRuntime({
    plugins: resolved.plugins,
    context: { sandbox, previewConsole: { getErrors: () => [] } },
  });
};

const noSkillRuntime = runtimeFor([]);
assert.deepEqual(noSkillRuntime.list(), []);
assert.equal((await noSkillRuntime.execute("sandbox.listFiles", {})).error?.code, "COMMAND_NOT_FOUND");
assert.equal((await noSkillRuntime.execute("ddb.getSchema", {})).error?.code, "COMMAND_NOT_FOUND");
assert.equal((await noSkillRuntime.execute("image.generate", { prompt: "x" })).error?.code, "COMMAND_NOT_FOUND");

const sandboxRuntime = runtimeFor(["sandbox"]);
assert.ok(sandboxRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.equal(sandboxRuntime.list().some((command) => command.name.startsWith("ddb.")), false);
assert.equal(sandboxRuntime.list().some((command) => command.name.startsWith("image.")), false);

const dynamicRuntime = runtimeFor(["dynamic-db"]);
assert.ok(dynamicRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(dynamicRuntime.list().some((command) => command.name === "ddb.getSchema"));

const imageRuntime = runtimeFor(["lite-image"]);
assert.ok(imageRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(imageRuntime.list().some((command) => command.name === "image.generate"));
assert.equal(imageRuntime.list().some((command) => command.name.startsWith("ddb.")), false);

const questRuntime = runtimeFor(["interactive-quest"]);
assert.ok(questRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(questRuntime.list().some((command) => command.name === "image.generate"));
assert.equal(questRuntime.list().some((command) => command.name.startsWith("ddb.")), false);

const questLearningRuntime = runtimeFor(["quest-learning"]);
assert.ok(questLearningRuntime.list().some((command) => command.name === "sandbox.listFiles"));
assert.ok(questLearningRuntime.list().some((command) => command.name === "image.generate"));
assert.equal(questLearningRuntime.list().some((command) => command.name.startsWith("ddb.")), false);

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
