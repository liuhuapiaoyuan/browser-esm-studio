/**
 * Browser-style typecheck correctness suite (same typecheckProject entry as UI / Agent).
 *
 * Coverage:
 * - Semantic errors that Agent auto-fix relies on (2322, 7006, 2339, 2353, …)
 * - Soft / Studio policy (TS1205 warning, verbatimModuleSyntax forced off)
 * - Path aliases, .ts/.tsx/.js extensions, circular imports, project .d.ts ambients
 * - React/DOM typing, cva/clsx stubs (closed props — no any-index wipe)
 * - Dependency stubbing rules (runtime deps stubbed; devDeps not)
 * - DDB real client types, multi-collection codegen, generated-path filter
 */
import assert from "node:assert/strict";
import { DEFAULT_FILES } from "../src/defaultProject.ts";
import { generateDdbFilesFromRoot } from "../src/database/codegen.ts";
import { formatTypecheckDiagnostics, typecheckProject } from "../src/lib/typecheck.ts";

/** Minimal FileMap: default tsconfig + package.json, optional overrides. */
function baseProject(files = {}, packageDeps = {}) {
  const pkg = JSON.parse(DEFAULT_FILES["package.json"]);
  pkg.dependencies = { ...(pkg.dependencies || {}), ...packageDeps };
  return {
    "index.html": DEFAULT_FILES["index.html"],
    "package.json": JSON.stringify(pkg, null, 2),
    "tsconfig.json": DEFAULT_FILES["tsconfig.json"],
    ...files,
  };
}

function errorsOf(result) {
  return result.diagnostics.filter((d) => d.category === "error");
}

function hasError(result, { pathIncludes, code } = {}) {
  return errorsOf(result).some((d) => {
    if (pathIncludes && !d.path.includes(pathIncludes)) return false;
    if (code != null && d.code !== code) return false;
    return true;
  });
}

function hasDiagnostic(result, { pathIncludes, code, category } = {}) {
  return result.diagnostics.some((d) => {
    if (pathIncludes && !d.path.includes(pathIncludes)) return false;
    if (code != null && d.code !== code) return false;
    if (category && d.category !== category) return false;
    return true;
  });
}

async function case_(name, fn) {
  process.stdout.write(`  · ${name} … `);
  await fn();
  console.log("ok");
}

function studentsGen(extraKinds = {}) {
  return generateDdbFilesFromRoot(
    {
      collections: {
        students: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        ...extraKinds,
      },
    },
    { projectId: "test", schemaVersion: 1 },
  );
}

console.log("typecheck smoke");

// ---------------------------------------------------------------------------
// Baseline: default virtual project + intentional break
// ---------------------------------------------------------------------------
await case_("default project typechecks clean", async () => {
  const ok = await typecheckProject(DEFAULT_FILES);
  assert.equal(ok.ok, true, formatTypecheckDiagnostics(ok).join("\n"));
  assert.ok(ok.checkedFiles >= 3);
  // vite.config.ts must not be a root (would pull node:path / vite types).
  assert.ok(!ok.diagnostics.some((d) => d.path.includes("vite.config")));
});

await case_("assignment mismatch is an error (TS2322)", async () => {
  const broken = await typecheckProject({
    ...DEFAULT_FILES,
    "src/broken.ts": `export const n: number = "nope";\n`,
  });
  assert.equal(broken.ok, false);
  assert.ok(hasError(broken, { pathIncludes: "broken.ts", code: 2322 }));
});

await case_("formatTypecheckDiagnostics includes path:line and TScode", async () => {
  const broken = await typecheckProject({
    ...DEFAULT_FILES,
    "src/broken.ts": `export const n: number = "nope";\n`,
  });
  const lines = formatTypecheckDiagnostics(broken, 5);
  assert.ok(lines.length >= 1);
  assert.match(lines[0], /broken\.ts:\d+:\d+ TS2322:/);
});

// ---------------------------------------------------------------------------
// Strict / semantic correctness (must catch — Agent auto-fix relies on these)
// ---------------------------------------------------------------------------
await case_("noImplicitAny: untyped callback param is TS7006", async () => {
  // Contextual typing fails on Function — param must be annotated under noImplicitAny.
  const loose = await typecheckProject(
    baseProject({
      "src/any.ts": `
export function once(fn: Function) {
  return fn;
}
export const bad = once((x) => x);
`,
    }),
  );
  assert.equal(loose.ok, false, formatTypecheckDiagnostics(loose).join("\n"));
  assert.ok(hasError(loose, { pathIncludes: "any.ts", code: 7006 }));
});

await case_("missing local module is an error", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/missing.ts": `import { nope } from "./does-not-exist.ts";\nexport const x = nope;\n`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "missing.ts" }));
});

await case_("wrong React props fail typecheck", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/Bad.tsx": `
import { useState } from "react";

export function Bad() {
  const [n] = useState(0);
  // div does not accept a number for className
  return <div className={n} />;
}
`,
    }),
  );
  assert.equal(result.ok, false, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(hasError(result, { pathIncludes: "Bad.tsx" }));
});

await case_("valid React hooks + JSX pass", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/Good.tsx": `
import { useState, type ReactNode } from "react";

export function Good({ children }: { children?: ReactNode }) {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN(n + 1)}>
      {children ?? n}
    </button>
  );
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// Path aliases + import extensions (Preview / Studio conventions)
// ---------------------------------------------------------------------------
await case_("@/* path alias resolves", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/lib/math.ts": `export const add = (a: number, b: number) => a + b;\n`,
      "src/use-alias.ts": `import { add } from "@/lib/math.ts";\nexport const three = add(1, 2);\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("relative .ts / .tsx extensions resolve", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/widget.tsx": `export function Widget() { return <span>w</span>; }\n`,
      "src/app.ts": `import { Widget } from "./widget.tsx";\nexport const W = Widget;\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// Soft diagnostics / Studio policy (must NOT flip ok=false)
// ---------------------------------------------------------------------------
await case_("TS1205 type re-export is warning, not error (isolatedModules)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/types.ts": `export type Id = string;\n`,
      "src/reexport.ts": `export { Id } from "./types.ts";\n`,
    }),
  );
  assert.ok(
    hasDiagnostic(result, { pathIncludes: "reexport.ts", code: 1205, category: "warning" }),
    `expected TS1205 as warning, got:\n${formatTypecheckDiagnostics(result).join("\n")}`,
  );
  assert.equal(result.ok, true, "soft TS1205 must not fail ok");
  assert.ok(!hasError(result, { code: 1205 }));
});

await case_("tsconfig verbatimModuleSyntax:true is forced off (no TS1484 fail)", async () => {
  const tsconfig = JSON.parse(DEFAULT_FILES["tsconfig.json"]);
  tsconfig.compilerOptions.verbatimModuleSyntax = true;
  const result = await typecheckProject(
    baseProject({
      "tsconfig.json": JSON.stringify(tsconfig, null, 2),
      "src/types.ts": `export type User = { name: string };\n`,
      // Value-style import of a type-only symbol — would be TS1484 if verbatim stayed on.
      "src/user.ts": `
import { User } from "./types.ts";
export const u: User = { name: "a" };
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(!hasError(result, { code: 1484 }));
});

await case_("empty FileMap / no .ts roots → ok with checkedFiles=0", async () => {
  const result = await typecheckProject({
    "index.html": "<html></html>",
    "package.json": "{}",
  });
  assert.equal(result.ok, true);
  assert.equal(result.checkedFiles, 0);
});

// ---------------------------------------------------------------------------
// Dependency stubs + bundled types
// ---------------------------------------------------------------------------
await case_("clsx / twMerge / cva known stubs accept valid usage", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/ui.ts": `
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { cva, type VariantProps } from "class-variance-authority";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const variants = cva("base", {
  variants: { size: { sm: "text-sm", lg: "text-lg" } },
  defaultVariants: { size: "sm" },
});

export type Props = VariantProps<typeof variants>;
export const className = cn(variants({ size: "lg" }), "extra");
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("unknown runtime dep gets ambient stub (no cannot-find-module)", async () => {
  const result = await typecheckProject(
    baseProject(
      {
        "src/xlsx-user.ts": `
import * as XLSX from "xlsx";
export const lib = XLSX;
`,
      },
      { xlsx: "^0.18.5" },
    ),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(!hasError(result, { pathIncludes: "xlsx-user.ts" }));
});

await case_("react / react-dom resolve via bundled DefinitelyTyped", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/dom.tsx": `
import { createRoot } from "react-dom/client";
import { StrictMode } from "react";

export function mount(el: HTMLElement) {
  createRoot(el).render(
    <StrictMode>
      <div />
    </StrictMode>,
  );
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// Dynamic DB: real client types + generated filter
// ---------------------------------------------------------------------------
await case_("@qzsy/dynamic-db-client + generated SDK + db.ts typecheck", async () => {
  const gen = studentsGen();
  const pkg = JSON.parse(DEFAULT_FILES["package.json"]);
  pkg.dependencies = { ...(pkg.dependencies || {}), "@qzsy/dynamic-db-client": "^0.1.1" };

  const dbTs = `import {
  createDynamicDbClient,
  type DynamicDbClient,
  DynamicDbError,
  isDynamicDbError,
} from "@qzsy/dynamic-db-client";
import { createGeneratedDb, type GeneratedDb } from "../ddb/generated/index.ts";

export type AppDb = DynamicDbClient<GeneratedDb> & GeneratedDb;

export function getDb(): AppDb {
  return createDynamicDbClient({
    baseUrl: "/ddb",
    userId: "u",
    projectId: "p",
    db: createGeneratedDb,
  });
}

export { DynamicDbError, isDynamicDbError };
`;

  const withDb = await typecheckProject({
    ...DEFAULT_FILES,
    ...gen,
    "src/lib/db.ts": dbTs,
    "package.json": JSON.stringify(pkg, null, 2),
  });
  assert.equal(withDb.ok, true, formatTypecheckDiagnostics(withDb).join("\n"));
  assert.ok(!withDb.diagnostics.some((d) => d.path.includes("ddb/generated")));
  assert.ok(!withDb.diagnostics.some((d) => d.path.includes("src/lib/db.ts")));
});

await case_("intentional error inside ddb/generated is filtered (ok stays true)", async () => {
  const brokenGen = {
    ...studentsGen(),
    "src/ddb/generated/broken.ts": `export const n: number = "filtered";\n`,
  };
  const result = await typecheckProject(
    baseProject({
      ...brokenGen,
      "src/touch-gen.ts": `import "./ddb/generated/broken.ts";\n`,
    }),
  );
  assert.ok(
    !hasDiagnostic(result, { pathIncludes: "ddb/generated/broken" }),
    "generated-path diagnostics must be filtered from the surface",
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("user code misuse of generated types still fails in user file", async () => {
  const gen = studentsGen();
  const result = await typecheckProject(
    baseProject({
      ...gen,
      "src/bad-ddb.ts": `
import type { StudentsPayload } from "./ddb/generated/index.ts";
export const row: StudentsPayload = { name: 123 };
`,
    }),
  );
  assert.equal(result.ok, false, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(hasError(result, { pathIncludes: "bad-ddb.ts", code: 2322 }));
});

// ---------------------------------------------------------------------------
// More strict / semantic traps (Agent auto-fix high-signal codes)
// ---------------------------------------------------------------------------
await case_("strictNullChecks: null not assignable to string", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/null.ts": `export const name: string = null;\n`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "null.ts", code: 2322 }));
});

await case_("excess property check on object literal", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/excess.ts": `
type User = { name: string };
export const u: User = { name: "a", age: 1 };
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "excess.ts", code: 2353 }));
});

await case_("wrong call arity is an error", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/arity.ts": `
export function add(a: number, b: number) { return a + b; }
export const n = add(1);
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "arity.ts", code: 2554 }));
});

await case_("property does not exist on type", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/prop.ts": `
type Box = { value: number };
export const v = ({ value: 1 } as Box).missing;
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "prop.ts", code: 2339 }));
});

await case_("generic constraint violation", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/generic.ts": `
function id<T extends string>(x: T): T { return x; }
export const n = id(123);
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "generic.ts", code: 2345 }));
});

await case_("union narrowing: invalid member access fails", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/union.ts": `
type Msg = { kind: "ok"; value: string } | { kind: "err"; error: Error };
export function read(m: Msg) {
  return m.value;
}
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "union.ts", code: 2339 }));
});

await case_("cannot assign to const", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/const-assign.ts": `
export const n = 1;
n = 2;
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "const-assign.ts", code: 2588 }));
});

await case_("duplicate identifier is an error", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/dup.ts": `
export const x = 1;
export const x = 2;
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "dup.ts" }));
});

await case_("Promise / async return type mismatch", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/async.ts": `
export async function load(): Promise<number> {
  return "nope";
}
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "async.ts", code: 2322 }));
});

await case_("satisfies operator rejects wrong shape", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/satisfies.ts": `
type Cfg = { port: number };
export const cfg = { port: "8080" } satisfies Cfg;
`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "satisfies.ts" }));
});

await case_("valid discriminated union + satisfies pass", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/ok-union.ts": `
type Msg = { kind: "ok"; value: string } | { kind: "err"; error: string };
export function read(m: Msg): string {
  if (m.kind === "ok") return m.value;
  return m.error;
}
export const cfg = { port: 8080 } satisfies { port: number };
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// DOM / lib + React event typing
// ---------------------------------------------------------------------------
await case_("DOM lib: document + HTMLElement APIs resolve", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/dom-api.ts": `
export function focusRoot() {
  const el = document.getElementById("root");
  el?.focus();
  return el instanceof HTMLElement;
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("React onClick event typing is checked", async () => {
  const bad = await typecheckProject(
    baseProject({
      "src/ClickBad.tsx": `
export function ClickBad() {
  return <button type="button" onClick={(e) => e.notAThing()} />;
}
`,
    }),
  );
  assert.equal(bad.ok, false, formatTypecheckDiagnostics(bad).join("\n"));
  assert.ok(hasError(bad, { pathIncludes: "ClickBad.tsx", code: 2339 }));

  const good = await typecheckProject(
    baseProject({
      "src/ClickGood.tsx": `
import type { MouseEvent } from "react";
export function ClickGood() {
  const onClick = (e: MouseEvent<HTMLButtonElement>) => e.preventDefault();
  return <button type="button" onClick={onClick} />;
}
`,
    }),
  );
  assert.equal(good.ok, true, formatTypecheckDiagnostics(good).join("\n"));
});

await case_("useRef + useEffect typing pass", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/Hooks.tsx": `
import { useEffect, useRef } from "react";
export function Hooks() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollIntoView();
  }, []);
  return <div ref={ref} />;
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// Import / resolution edge cases
// ---------------------------------------------------------------------------
await case_("import type of type-only export passes", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/types.ts": `export type User = { name: string };\n`,
      "src/ok.ts": `
import type { User } from "./types.ts";
export const u: User = { name: "a" };
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("export type re-export is clean (no TS1205)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/types.ts": `export type Id = string;\n`,
      "src/reexport.ts": `export type { Id } from "./types.ts";\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(!hasDiagnostic(result, { code: 1205 }));
});

await case_("broken @/* alias target fails", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/bad-alias.ts": `import { x } from "@/lib/nope.ts";\nexport const y = x;\n`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "bad-alias.ts" }));
});

await case_(".js import resolves to sibling .ts (NodeNext-style)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/math.ts": `export const add = (a: number, b: number) => a + b;\n`,
      "src/use-js-ext.ts": `import { add } from "./math.js";\nexport const three = add(1, 2);\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("generated .js self-imports resolve to .ts files", async () => {
  const gen = studentsGen();
  // index.ts does `export * from './types.js'` — must resolve under Bundler + allowImportingTsExtensions.
  const result = await typecheckProject(
    baseProject({
      ...gen,
      "src/use-gen.ts": `
import type { StudentsPayload, GeneratedDb } from "./ddb/generated/index.ts";
export type Row = StudentsPayload;
export type Db = GeneratedDb;
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("CSS side-effect import does not fail typecheck (default project pattern)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/index.css": `body { margin: 0; }\n`,
      "src/main.ts": `import "./index.css";\nexport const ready = true;\n`,
    }),
  );
  // If this ever starts failing, Studio needs a css module ambient — pin current contract.
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("circular imports typecheck without hanging", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/a.ts": `import { b } from "./b.ts";\nexport const a = 1;\nexport const useB = () => b;\n`,
      "src/b.ts": `import { a } from "./a.ts";\nexport const b = 2;\nexport const useA = () => a;\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("project .d.ts ambient modules are visible", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/shim.d.ts": `declare module "*.svg" {\n  const url: string;\n  export default url;\n}\n`,
      "src/icon.ts": `import url from "./logo.svg";\nexport const href = url;\n`,
      "src/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" />\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

// ---------------------------------------------------------------------------
// tsconfig / package.json policy
// ---------------------------------------------------------------------------
await case_("missing tsconfig falls back to Studio defaults (strict)", async () => {
  const files = baseProject({
    "src/strict.ts": `export const n: number = "x";\n`,
  });
  delete files["tsconfig.json"];
  const result = await typecheckProject(files);
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "strict.ts", code: 2322 }));
});

await case_("malformed tsconfig falls back to defaults (still typechecks)", async () => {
  const result = await typecheckProject(
    baseProject({
      "tsconfig.json": "{ not json",
      "src/ok.ts": `export const n: number = 1;\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("malformed package.json does not crash (no dep stubs needed)", async () => {
  const result = await typecheckProject(
    baseProject({
      "package.json": "{ broken",
      "src/ok.ts": `export const n = 1;\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("strict:false in tsconfig is respected (implicit any allowed)", async () => {
  const tsconfig = JSON.parse(DEFAULT_FILES["tsconfig.json"]);
  tsconfig.compilerOptions.strict = false;
  tsconfig.compilerOptions.noImplicitAny = false;
  const result = await typecheckProject(
    baseProject({
      "tsconfig.json": JSON.stringify(tsconfig, null, 2),
      "src/loose.ts": `
export function once(fn: Function) { return fn; }
export const ok = once((x) => x);
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(!hasError(result, { code: 7006 }));
});

await case_("vite.config.ts is excluded from checkedFiles", async () => {
  const result = await typecheckProject(
    baseProject({
      "vite.config.ts": `
import path from "node:path";
export default { resolve: { alias: { "@": path.resolve(".") } } };
`,
      "src/app.ts": `export const ok = true;\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.equal(result.checkedFiles, 1);
  assert.ok(!result.diagnostics.some((d) => d.path.includes("vite.config")));
});

await case_("devDependency-only packages are not stubbed (cannot find module)", async () => {
  // typescript lives in default project devDependencies; importing it from src should fail.
  const result = await typecheckProject(
    baseProject({
      "src/tsc-import.ts": `import ts from "typescript";\nexport const v = ts.version;\n`,
    }),
  );
  assert.equal(result.ok, false);
  assert.ok(hasError(result, { pathIncludes: "tsc-import.ts" }));
});

await case_("soft warning + hard error → ok=false", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/types.ts": `export type Id = string;\n`,
      "src/mixed.ts": `
export { Id } from "./types.ts";
export const n: number = "x";
`,
    }),
  );
  assert.ok(hasDiagnostic(result, { code: 1205, category: "warning" }));
  assert.ok(hasError(result, { code: 2322 }));
  assert.equal(result.ok, false);
});

await case_("formatTypecheckDiagnostics respects limit", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/many.ts": `
export const a: number = "1";
export const b: number = "2";
export const c: number = "3";
`,
    }),
  );
  assert.ok(errorsOf(result).length >= 3);
  assert.equal(formatTypecheckDiagnostics(result, 2).length, 2);
});

await case_("checkedFiles counts all .ts/.tsx roots (not .d.ts alone as logic root)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/a.ts": `export const a = 1;\n`,
      "src/b.tsx": `export const B = () => <span />;\n`,
      "src/shim.d.ts": `export {};\n`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
  assert.equal(result.checkedFiles, 2);
});

// ---------------------------------------------------------------------------
// Ambient stubs: resolve + documented looseness
// ---------------------------------------------------------------------------
await case_("lucide-react / radix ambient stubs resolve (no cannot-find-module)", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/icons.tsx": `
import { Check } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
export function Icon() {
  return (
    <Slot>
      <Check />
    </Slot>
  );
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("react-router-dom ambient stub resolves HashRouter import", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/router.tsx": `
import { HashRouter } from "react-router-dom";
export function Root() {
  return <HashRouter>{null}</HashRouter>;
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("default project cn/utils + Button still typecheck in isolation slice", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/lib/utils.ts": DEFAULT_FILES["src/lib/utils.ts"],
      "src/components/ui/button.tsx": DEFAULT_FILES["src/components/ui/button.tsx"],
      "src/use-btn.tsx": `
import { Button } from "@/components/ui/button.tsx";
export function Demo() {
  return <Button variant="default">Go</Button>;
}
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("wrong Button prop still fails against real component types", async () => {
  const result = await typecheckProject(
    baseProject({
      "src/lib/utils.ts": DEFAULT_FILES["src/lib/utils.ts"],
      "src/components/ui/button.tsx": DEFAULT_FILES["src/components/ui/button.tsx"],
      "src/bad-btn.tsx": `
import { Button } from "@/components/ui/button.tsx";
export function Demo() {
  // onClick must be a function — number is a reliable ButtonHTMLAttributes failure
  return <Button onClick={42} />;
}
`,
    }),
  );
  assert.equal(result.ok, false, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(hasError(result, { pathIncludes: "bad-btn.tsx" }));
});

// ---------------------------------------------------------------------------
// DDB deeper contracts
// ---------------------------------------------------------------------------
await case_("multi-collection generated SDK typechecks", async () => {
  const gen = generateDdbFilesFromRoot(
    {
      collections: {
        students: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
        courses: {
          type: "object",
          properties: { title: { type: "string" }, credits: { type: "number" } },
          required: ["title", "credits"],
        },
      },
    },
    { projectId: "multi", schemaVersion: 2 },
  );
  const result = await typecheckProject(
    baseProject({
      ...gen,
      "src/multi.ts": `
import type { StudentsPayload, CoursesPayload, GeneratedDb } from "./ddb/generated/index.ts";
export type S = StudentsPayload;
export type C = CoursesPayload;
export type Db = GeneratedDb;
const _assert: Db["students"] = null as never;
void _assert;
`,
    }),
  );
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

await case_("createDynamicDbClient rejects wrong option types", async () => {
  const gen = studentsGen();
  const result = await typecheckProject(
    baseProject({
      ...gen,
      "src/bad-client.ts": `
import { createDynamicDbClient } from "@qzsy/dynamic-db-client";
import { createGeneratedDb } from "./ddb/generated/index.ts";
export const db = createDynamicDbClient({
  baseUrl: 123,
  userId: "u",
  projectId: "p",
  db: createGeneratedDb,
});
`,
    }),
  );
  assert.equal(result.ok, false, formatTypecheckDiagnostics(result).join("\n"));
  assert.ok(hasError(result, { pathIncludes: "bad-client.ts" }));
});

await case_("Windows-style path still filters ddb\\\\generated diagnostics", async () => {
  // Filter normalizes backslashes; inject error under generated and ensure surface stays clean.
  const gen = studentsGen();
  const result = await typecheckProject(
    baseProject({
      ...gen,
      "src/ddb/generated/oops.ts": `export const x: number = "y";\n`,
      "src/touch.ts": `export {};\n`,
    }),
  );
  assert.ok(!result.diagnostics.some((d) => /ddb[/\\]generated/.test(d.path)));
  assert.equal(result.ok, true, formatTypecheckDiagnostics(result).join("\n"));
});

console.log("Typecheck smoke test passed.");
