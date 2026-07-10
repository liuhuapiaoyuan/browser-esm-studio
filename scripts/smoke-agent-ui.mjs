import assert from "node:assert/strict";
import { splitTaggedReasoning } from "../src/components/ai-elements/agent-response.tsx";

const output = splitTaggedReasoning(
  "<think>Inspect files</think>\n\n<think>Apply changes</think>\n\n**完成**\n- 更新界面",
);

assert.equal(output.reasoning, "Inspect files\n\nApply changes");
assert.equal(output.response, "**完成**\n- 更新界面");

console.log("Agent UI smoke test passed.");
