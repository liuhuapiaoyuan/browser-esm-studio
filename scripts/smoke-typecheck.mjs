import assert from "node:assert/strict";
import { DEFAULT_FILES } from "../src/defaultProject.ts";
import { generateDdbFilesFromRoot } from "../src/database/codegen.ts";
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

// Real @qzsy/dynamic-db-client types + generated SDK + db.ts must typecheck.
const gen = generateDdbFilesFromRoot(
  {
    collections: {
      students: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
  { projectId: "test", schemaVersion: 1 },
);
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

console.log("Typecheck smoke test passed.");
