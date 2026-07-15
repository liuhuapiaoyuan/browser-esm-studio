import assert from "node:assert/strict";

// Minimal browser shims for createPreviewConsole
const timers = [];
globalThis.window = {
  setTimeout: (fn, ms) => {
    const id = timers.length + 1;
    timers.push({ id, fn, ms });
    // Run short waits immediately so the smoke test finishes.
    if (ms <= 160) queueMicrotask(() => fn());
    else setTimeout(fn, Math.min(ms, 20));
    return id;
  },
};

const { createPreviewConsole } = await import("../src/lib/preview-console.ts");

const previewConsole = createPreviewConsole();
assert.deepEqual(previewConsole.getErrors(), []);

previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "console",
  payload: { level: "error", args: ["ReferenceError: x is not defined"] },
});
previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "error",
  payload: { message: "boom", stack: "Error: boom\n    at App.tsx:1" },
});
previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "console",
  payload: { level: "warn", args: ["deprecated"] },
});
previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "console",
  payload: { level: "log", args: ["ok"] },
});

const errors = previewConsole.getErrors();
assert.equal(errors.length, 3);
assert.match(errors[0], /ReferenceError/);
assert.match(errors[1], /Error: boom/);
assert.equal(errors[2], "deprecated");

// Sync cycle: dirty wait must observe the new generation's ready + errors.
const waiting = previewConsole.waitForErrors(50);
const token = previewConsole.beginSync();
assert.equal(previewConsole.endSync(token), true);
previewConsole.handleMessage({ source: "browser-esm-preview", type: "ready", payload: { phase: "bridge" } });
previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "console",
  payload: { level: "error", args: ["runtime fail"] },
});
const afterSync = await waiting;
assert.ok(afterSync.some((line) => line.includes("runtime fail")));

// Stale sync completion must be ignored.
const t1 = previewConsole.beginSync();
previewConsole.markDirty();
assert.equal(previewConsole.endSync(t1), false);
const t2 = previewConsole.beginSync();
assert.equal(previewConsole.endSync(t2), true);

previewConsole.handleMessage({
  source: "browser-esm-preview",
  type: "error",
  payload: {
    message: 'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "application/json" (package.json).',
    stack: "http://localhost/__preview__/x/package.json",
  },
});
assert.ok(
  previewConsole.getErrors().some((line) => line.includes('MIME type of "application/json"')),
  "location-only stack must not hide MIME message",
);

console.log("smoke-preview-console: ok");
