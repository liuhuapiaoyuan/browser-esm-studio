import assert from "node:assert/strict";
import { splitTaggedReasoning } from "../src/components/ai-elements/agent-response.tsx";
import {
  isSkillDependencyLocked,
  snapshotSkillIds,
  updateRequestedSkillIds,
} from "../src/components/skill-picker.tsx";
import {
  appendToolArgDelta,
  extractStreamingFileFields,
  isCliFileBodyRaw,
} from "../src/lib/ai/stream-file-preview.ts";

const output = splitTaggedReasoning(
  "<think>Inspect files</think>\n\n<think>Apply changes</think>\n\n**完成**\n- 更新界面",
);

assert.equal(output.reasoning, "Inspect files\n\nApply changes");
assert.equal(output.response, "**完成**\n- 更新界面");

const skills = [
  {
    id: "sandbox",
    title: "Sandbox",
    description: "files",
    requires: [],
    defaultEnabled: true,
  },
  {
    id: "dynamic-db",
    title: "Dynamic DB",
    description: "database",
    requires: ["sandbox"],
    defaultEnabled: false,
  },
];
assert.deepEqual(updateRequestedSkillIds(skills, ["sandbox"], "dynamic-db", true), [
  "sandbox",
  "dynamic-db",
]);
assert.deepEqual(updateRequestedSkillIds(skills, ["sandbox", "dynamic-db"], "sandbox", false), [
  "dynamic-db",
]);
assert.equal(isSkillDependencyLocked({ sandbox: ["dynamic-db"] }, "sandbox"), true);
assert.equal(isSkillDependencyLocked({ sandbox: ["dynamic-db"] }, "dynamic-db"), false);

const liveSkills = ["sandbox"];
const frozenSkills = snapshotSkillIds(liveSkills);
liveSkills.push("dynamic-db");
assert.deepEqual(frozenSkills, ["sandbox"]);

// Nested-object cli_execute (unescaped keys in the raw stream).
assert.deepEqual(
  extractStreamingFileFields(
    '{"command":"sandbox.addFile","arguments":{"path":"src/App.tsx","content":"export const x = 1;\\n"}}',
  ),
  { path: "src/App.tsx", content: "export const x = 1;\n" },
);

// Stringified arguments bag — the common CLI streaming shape that previously broke previews.
const stringifiedPartial =
  '{"command":"sandbox.addFile","arguments":"{\\"path\\":\\"src/Card.tsx\\",\\"content\\":\\"export function Card() {\\n  return null;\\n}"';
assert.equal(isCliFileBodyRaw(stringifiedPartial), true);
assert.deepEqual(extractStreamingFileFields(stringifiedPartial), {
  path: "src/Card.tsx",
  content: "export function Card() {\n  return null;\n}",
});

// Flattened form still works.
assert.deepEqual(
  extractStreamingFileFields(
    '{"command":"sandbox.writeFile","path":"src/a.ts","content":"const a = 1"}',
  ),
  { path: "src/a.ts", content: "const a = 1" },
);

// Hybrid: path at top level, content only inside stringified arguments.
assert.deepEqual(
  extractStreamingFileFields(
    '{"command":"sandbox.addFile","path":"src/d.tsx","arguments":"{\\"content\\":\\"code here"}',
  ),
  { path: "src/d.tsx", content: "code here" },
);

// Path aliases used by models / normalize-args.
assert.deepEqual(
  extractStreamingFileFields(
    '{"command":"sandbox.addFile","arguments":{"file":"src/e.tsx","content":"export fn"}}',
  ),
  { path: "src/e.tsx", content: "export fn" },
);

// Cumulative provider snapshots must not duplicate the JSON prefix.
assert.equal(
  appendToolArgDelta('{"command":"sandbox.addFile"', '{"command":"sandbox.addFile","arguments":{'),
  '{"command":"sandbox.addFile","arguments":{',
);
assert.equal(
  appendToolArgDelta('{"command":"sandbox.addFile"', ',"path":"x"'),
  '{"command":"sandbox.addFile","path":"x"',
);

console.log("Agent UI smoke test passed.");
