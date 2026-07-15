import assert from "node:assert/strict";
import { createSandbox } from "../src/lib/sandbox.ts";
import { createAgentCliRuntime, createAgentCliTools } from "../src/lib/agent-cli/index.ts";
import { ddbPlugin } from "../src/lib/agent-cli/plugins/ddb/index.ts";
import { sandboxPlugin } from "../src/lib/agent-cli/plugins/sandbox/index.ts";
import { defineCommand } from "../src/lib/agent-cli/define-command.ts";
import { z } from "zod";

const sandbox = createSandbox({
  "index.html": "<!doctype html><html></html>",
  "package.json": "{}",
  "src/hello.ts": "export const hello = 'world';\n",
});

const echo = defineCommand({
  metadata: {
    name: "test.echo",
    version: "1.0.0",
    title: "Echo",
    summary: "Echo input for smoke tests",
    tags: ["test", "echo"],
  },
  agent: {
    purpose: "Return the message unchanged",
    useWhen: ["smoke testing the runtime"],
    examples: [{ userRequest: "echo hi", input: { message: "hi" } }],
  },
  inputSchema: z.object({
    message: z.string().describe("Message to echo"),
  }),
  outputSchema: z.object({ message: z.string() }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(input) {
    return { message: input.message };
  },
});

const runtime = createAgentCliRuntime({
  plugins: [sandboxPlugin, ddbPlugin],
  commands: [echo],
  context: {
    sandbox,
    previewConsole: { getErrors: () => [] },
  },
});

const schemaHits = runtime.search("schema", 5);
assert.ok(
  schemaHits.some((h) => h.name === "ddb.setupSchema"),
  `expected ddb.setupSchema in search hits, got: ${schemaHits.map((h) => h.name).join(", ")}`,
);

const fileHits = runtime.search("read file grep list", 8);
assert.ok(
  fileHits.some((h) => h.name === "sandbox.readFile" || h.name === "sandbox.grep"),
  `expected sandbox file commands in search, got: ${fileHits.map((h) => h.name).join(", ")}`,
);

const described = runtime.describe("ddb.setupSchema", "full");
assert.equal(described.ok, true);
if (described.ok) {
  assert.match(described.prompt, /PURPOSE/i);
  assert.match(described.prompt, /rootSchema/);
  assert.match(described.prompt, /ddb\.setupSchema/);
}

const invalid = runtime.validate("ddb.listRecords", {});
assert.equal(invalid.ok, false);
if (!invalid.ok) {
  assert.equal(invalid.error && "code" in invalid.error && invalid.error.code, "INVALID_ARGUMENT");
}

const okExec = await runtime.execute("test.echo", { message: "ping" });
assert.equal(okExec.ok, true);
assert.equal(okExec.command, "test.echo");
assert.ok(okExec.executionId.startsWith("exec_"));
assert.deepEqual(okExec.data, { message: "ping" });

const listedFiles = await runtime.execute("sandbox.listFiles", {});
assert.equal(listedFiles.ok, true);
assert.ok(
  Array.isArray(listedFiles.data?.files) && listedFiles.data.files.includes("src/hello.ts"),
);

const read = await runtime.execute("sandbox.readFile", { path: "src/hello.ts" });
assert.equal(read.ok, true);
assert.match(String(read.data?.content ?? ""), /hello/);

// Models often pass line numbers as strings — normalize-args must coerce
const readWindow = await runtime.execute("sandbox.readFile", {
  path: "src/hello.ts",
  around: "1",
  radius: "20",
});
assert.equal(readWindow.ok, true, readWindow.error?.message);
assert.match(String(readWindow.data?.content ?? ""), /hello/);

const readRange = await runtime.execute("sandbox.readFile", {
  path: "src/hello.ts",
  startLine: "1",
  endLine: "10",
});
assert.equal(readRange.ok, true, readRange.error?.message);

const readNullLine = await runtime.execute("sandbox.readFile", {
  path: "src/hello.ts",
  startLine: null,
});
assert.equal(readNullLine.ok, true, readNullLine.error?.message);

const grep = await runtime.execute("sandbox.grep", {
  query: "hello",
  outputMode: "files",
});
assert.equal(grep.ok, true);
assert.ok((grep.data?.count ?? 0) >= 1);

const write = await runtime.execute("sandbox.writeFile", {
  path: "src/note.ts",
  content: "export const note = 1;\n",
});
assert.equal(write.ok, true);

const replace = await runtime.execute("sandbox.replaceInFile", {
  path: "src/note.ts",
  oldString: "note = 1",
  newString: "note = 2",
});
assert.equal(replace.ok, true);

const typecheck = await runtime.execute("sandbox.typecheck", {});
assert.equal(typecheck.ok, true, typecheck.error?.message);

const preview = await runtime.execute("sandbox.getPreviewErrors", { wait: false });
assert.equal(preview.ok, true);

const previewFailRuntime = createAgentCliRuntime({
  plugins: [sandboxPlugin],
  context: {
    sandbox,
    previewConsole: { getErrors: () => ["Error: boom"] },
  },
});
const previewFail = await previewFailRuntime.execute("sandbox.getPreviewErrors", {
  wait: false,
});
assert.equal(previewFail.ok, false);
assert.equal(previewFail.error?.code, "PREVIEW_ERRORS");

const badExec = await runtime.execute("ddb.listRecords", {});
assert.equal(badExec.ok, false);
assert.equal(badExec.error?.code, "INVALID_ARGUMENT");
assert.ok(badExec.executionId);

const diag = runtime.diagnose(badExec.executionId);
assert.equal(diag.ok, false);
assert.ok(diag.suggestedActions.length > 0);
assert.ok(diag.recoveryPrompt || diag.cause);

const missing = await runtime.execute("no.such.command", {});
assert.equal(missing.ok, false);
assert.equal(missing.error?.code, "COMMAND_NOT_FOUND");

const listed = runtime.list();
assert.ok(listed.some((c) => c.name === "ddb.codegen"));
assert.ok(listed.some((c) => c.name === "sandbox.grep"));
assert.ok(listed.some((c) => c.name === "sandbox.typecheck"));
assert.ok(listed.some((c) => c.name === "sandbox.getPreviewErrors"));

// Flattened cli_execute-style args (common model mistake) via runtime normalize
const flatReplace = await runtime.execute("sandbox.replaceInFile", {
  path: "src/note.ts",
  old_string: "note = 2",
  new_string: "note = 3",
});
assert.equal(flatReplace.ok, true, flatReplace.error?.message);

const aliasedOps = await runtime.execute("sandbox.applyOperations", {
  operations: [
    {
      type: "writeFile",
      path: "src/aliased.ts",
      content: "export const a = 1;\n",
    },
  ],
});
assert.equal(aliasedOps.ok, true, aliasedOps.error?.message);

const sandboxOnlyRuntime = createAgentCliRuntime({
  plugins: [sandboxPlugin],
  context: { sandbox, previewConsole: { getErrors: () => [] } },
});
assert.equal(
  sandboxOnlyRuntime.search("schema setup", 10).some((hit) => hit.name.startsWith("ddb.")),
  false,
);
assert.equal(sandboxOnlyRuntime.describe("ddb.setupSchema").ok, false);
const filesBeforeDeniedDdb = sandbox.list();
const deniedDdb = await sandboxOnlyRuntime.execute("ddb.setupSchema", {
  rootSchema: { collections: {} },
});
assert.equal(deniedDdb.ok, false);
assert.equal(deniedDdb.error?.code, "COMMAND_NOT_FOUND");
assert.deepEqual(sandbox.list(), filesBeforeDeniedDdb);

const emptyRuntime = createAgentCliRuntime({
  plugins: [],
  context: { sandbox, previewConsole: { getErrors: () => [] } },
});
assert.deepEqual(emptyRuntime.list(), []);
assert.deepEqual(emptyRuntime.search("read schema", 20), []);
assert.equal((await emptyRuntime.execute("sandbox.listFiles", {})).error?.code, "COMMAND_NOT_FOUND");
assert.equal((await emptyRuntime.execute("ddb.getSchema", {})).error?.code, "COMMAND_NOT_FOUND");

const expectedMetaTools = ["cli_search", "cli_describe", "cli_execute", "cli_diagnose"];
assert.deepEqual(Object.keys(createAgentCliTools(emptyRuntime)), expectedMetaTools);
assert.deepEqual(Object.keys(createAgentCliTools(runtime)), expectedMetaTools);

// Models often wrap meta-tools as cli_execute.command — bridge must fulfill, not COMMAND_NOT_FOUND
const tools = createAgentCliTools(runtime);
const executeMeta = tools.cli_execute.execute;
assert.equal(typeof executeMeta, "function");
const toolOpts = {
  toolCallId: "smoke",
  messages: [],
  abortSignal: new AbortController().signal,
};
const miswrappedSearch = await executeMeta(
  { command: "cli_search", arguments: { query: "generate image illustration", limit: 5 } },
  { ...toolOpts, toolCallId: "smoke-meta-search" },
);
assert.equal(miswrappedSearch.ok, true);
assert.equal(miswrappedSearch.query, "generate image illustration");
assert.ok(Array.isArray(miswrappedSearch.commands));

const miswrappedDescribe = await executeMeta(
  { command: "cli_describe", arguments: { command: "sandbox.listFiles" } },
  { ...toolOpts, toolCallId: "smoke-meta-describe" },
);
assert.equal(miswrappedDescribe.ok, true);
assert.equal(miswrappedDescribe.command, "sandbox.listFiles");

const nestedExecute = await executeMeta(
  { command: "cli_execute", arguments: { command: "sandbox.listFiles" } },
  { ...toolOpts, toolCallId: "smoke-meta-nested" },
);
assert.equal(nestedExecute.ok, false);
assert.equal(nestedExecute.error?.code, "INVALID_ARGUMENT");

console.log("Agent CLI smoke test passed.");
