import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const outDir = await mkdtemp(join(tmpdir(), "sandbox-smoke-"));
const outfile = join(outDir, "sandbox.mjs");

try {
  await esbuild.build({
    entryPoints: ["src/lib/sandbox.ts"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "silent",
  });

  const { createSandbox, SandboxError } = await import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);

  const sandbox = createSandbox({
    "index.html": "<html></html>",
    "package.json": "{}",
    "src/a.ts": "const hello = 'world';\nconst helloAgain = 'world';\n",
    "src/b.ts": "export const value = 1;\n",
  });

  // grep: line/column/match
  const matches = sandbox.grep("hello");
  assert.equal(matches.length, 2);
  assert.equal(matches[0].path, "src/a.ts");
  assert.equal(matches[0].line, 1);
  assert.equal(matches[0].column, 7);
  assert.equal(matches[0].match, "hello");
  assert.equal(matches[1].line, 2);

  const regexMatches = sandbox.grep("value\\s*=\\s*\\d+", { regex: true, paths: ["src/b.ts"] });
  assert.equal(regexMatches.length, 1);
  assert.equal(regexMatches[0].path, "src/b.ts");

  assert.equal(sandbox.grep("missing").length, 0);

  // fuzzy: subsequence + multi-token, case-insensitive by default
  const fuzzyMatches = sandbox.grep("hllo", { fuzzy: true });
  assert.equal(fuzzyMatches.length, 2);
  assert.equal(fuzzyMatches[0].match.toLowerCase().includes("h"), true);
  assert.ok(typeof fuzzyMatches[0].score === "number");

  const fuzzyToken = sandbox.grep("hello world", { fuzzy: true, paths: ["src/a.ts"] });
  assert.equal(fuzzyToken.length, 2);
  assert.match(fuzzyToken[0].match, /hello.*world/i);

  const fuzzyCase = sandbox.grep("HELLO", { fuzzy: true, caseSensitive: true });
  assert.equal(fuzzyCase.length, 0);

  // glob path filter
  const globMatches = sandbox.grep("value", { glob: "src/*.ts" });
  assert.equal(globMatches.length, 1);
  assert.equal(globMatches[0].path, "src/b.ts");
  assert.equal(sandbox.grep("hello", { glob: "*.css" }).length, 0);

  assert.throws(() => sandbox.grep("x", { regex: true, fuzzy: true }), (error) => {
    assert.equal(error.code, "INVALID_OPERATION");
    return true;
  });

  // word: identifier boundaries
  sandbox.write(
    "src/word.ts",
    "const hello = 1;\nconst helloWorld = 2;\nconst xhello = 3;\n",
  );
  const wordMatches = sandbox.grep("hello", { word: true, paths: ["src/word.ts"] });
  assert.equal(wordMatches.length, 1);
  assert.equal(wordMatches[0].line, 1);
  assert.equal(sandbox.grep("hello", { paths: ["src/word.ts"] }).length, 3);

  assert.throws(() => sandbox.grep("x", { word: true, fuzzy: true }), (error) => {
    assert.equal(error.code, "INVALID_OPERATION");
    return true;
  });

  // context: before/after lines
  const withContext = sandbox.grep("helloAgain", { context: 1, paths: ["src/a.ts"] });
  assert.equal(withContext.length, 1);
  assert.deepEqual(withContext[0].before, ["const hello = 'world';"]);
  assert.deepEqual(withContext[0].after, [""]);

  // replace: literal first match by default
  const replaceOnce = sandbox.replace("src/a.ts", "world", "orbit");
  assert.deepEqual(replaceOnce.changed, ["src/a.ts"]);
  assert.equal(replaceOnce.counts["src/a.ts"], 1);
  assert.match(sandbox.read("src/a.ts"), /hello = 'orbit'/);
  assert.match(sandbox.read("src/a.ts"), /helloAgain = 'world'/);

  const replaceAll = sandbox.replace("src/a.ts", "hello", "hi", { replaceAll: true });
  assert.equal(replaceAll.counts["src/a.ts"], 2);
  assert.equal(sandbox.read("src/a.ts"), "const hi = 'orbit';\nconst hiAgain = 'world';\n");

  assert.throws(() => sandbox.replace("src/b.ts", "nope", "x"), (error) => {
    assert.ok(error instanceof SandboxError);
    assert.equal(error.code, "NO_MATCH");
    return true;
  });

  // add / write / remove
  sandbox.add("src/c.ts", "export const c = true;\n");
  assert.equal(sandbox.exists("src/c.ts"), true);
  assert.throws(() => sandbox.add("src/c.ts", "again"), (error) => {
    assert.equal(error.code, "ALREADY_EXISTS");
    return true;
  });

  sandbox.write("src/c.ts", "export const c = false;\n");
  assert.equal(sandbox.read("src/c.ts"), "export const c = false;\n");

  sandbox.remove("src/c.ts");
  assert.equal(sandbox.exists("src/c.ts"), false);
  assert.throws(() => sandbox.remove("src/c.ts"), (error) => {
    assert.equal(error.code, "NOT_FOUND");
    return true;
  });

  // path validation + protected files
  assert.throws(() => sandbox.add("/abs.ts", ""), (error) => {
    assert.equal(error.code, "INVALID_PATH");
    return true;
  });
  assert.throws(() => sandbox.remove("index.html"), (error) => {
    assert.equal(error.code, "PROTECTED_PATH");
    return true;
  });
  assert.throws(() => sandbox.remove("package.json"), (error) => {
    assert.equal(error.code, "PROTECTED_PATH");
    return true;
  });

  // apply is atomic: failure rolls back
  const before = sandbox.snapshot;
  assert.throws(
    () =>
      sandbox.apply([
        { type: "add", path: "src/temp.ts", content: "temp" },
        { type: "remove", path: "index.html" },
      ]),
    (error) => {
      assert.equal(error.code, "PROTECTED_PATH");
      return true;
    },
  );
  assert.equal(sandbox.exists("src/temp.ts"), false);
  assert.deepEqual(sandbox.snapshot, before);

  // successful apply + subscribe fires once per commit
  let notifications = 0;
  const unsubscribe = sandbox.subscribe(() => {
    notifications += 1;
  });
  const applied = sandbox.apply([
    { type: "add", path: "src/new.ts", content: "export {};\n" },
    { type: "replace", path: "src/b.ts", oldString: "1", newString: "2" },
  ]);
  assert.deepEqual(applied.changed.sort(), ["src/b.ts", "src/new.ts"]);
  assert.equal(notifications, 1);
  unsubscribe();

  // snapshot is frozen / not a live mutable handle
  const snap = sandbox.snapshot;
  assert.throws(() => {
    snap["hack.ts"] = "nope";
  });
  assert.equal(sandbox.exists("hack.ts"), false);

  // path normalization
  sandbox.add("src\\\\nested\\\\file.ts", "ok");
  assert.equal(sandbox.exists("src/nested/file.ts"), true);

  console.log("Sandbox SDK smoke test passed.");
} finally {
  await rm(outDir, { recursive: true, force: true });
}
