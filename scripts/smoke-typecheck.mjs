import assert from "node:assert/strict";
import { DEFAULT_FILES } from "../src/defaultProject.ts";
import { formatTypecheckDiagnostics, typecheckProject } from "../src/lib/typecheck.ts";

const ok = await typecheckProject(DEFAULT_FILES);
assert.equal(ok.ok, true, formatTypecheckDiagnostics(ok).join("\n"));
assert.ok(ok.checkedFiles >= 3);

const broken = await typecheckProject({
  ...DEFAULT_FILES,
  "src/broken.ts": `export const n: number = "nope";\n`,
});
assert.equal(broken.ok, false);
assert.ok(broken.diagnostics.some((item) => item.category === "error" && item.path.includes("broken.ts")));

console.log("Typecheck smoke test passed.");
