/**
 * Smoke: host codegen emitters + ensure stack against Sandbox (no network).
 */
import { createSandbox } from "../src/lib/sandbox.ts";
import { DEFAULT_FILES } from "../src/defaultProject.ts";
import { ensureDdbStack } from "../src/database/ensure-stack.ts";
import { generateDdbFilesFromRoot } from "../src/database/codegen.ts";

const projectId = "6a50cb177c442826a1f6f6da";
const sandbox = createSandbox({ ...DEFAULT_FILES });

const ensured = ensureDdbStack(sandbox, {
  projectId,
  userId: "dev-user",
  roles: ["admin"],
});

if (!sandbox.exists("src/lib/db.ts")) throw new Error("missing src/lib/db.ts");
if (!sandbox.exists("src/config/ddb-binding.ts")) throw new Error("missing ddb-binding");
if (!sandbox.exists(".env")) throw new Error("missing .env");
if (!sandbox.read("package.json").includes("@qzsy/dynamic-db-client")) {
  throw new Error("package.json missing dynamic-db-client");
}
if (!sandbox.read("src/config/ddb-binding.ts").includes(projectId)) {
  throw new Error("binding missing projectId");
}

const files = generateDdbFilesFromRoot(
  {
    collections: {
      students: {
        type: "object",
        properties: {
          name: { type: "string" },
          studentNo: { type: "string" },
        },
        required: ["name", "studentNo"],
      },
      "daily-records": {
        type: "object",
        properties: { note: { type: "string" } },
        required: ["note"],
      },
    },
  },
  { projectId, schemaVersion: 1 },
);

if (!files["src/ddb/generated/index.ts"].includes("kindNames")) {
  throw new Error("generated index missing kindNames");
}
if (!files["src/ddb/generated/index.ts"].includes("_daily_records")) {
  throw new Error("hyphenated kind should map to _daily_records");
}
if (!files["src/ddb/generated/kinds/students.delegate.ts"]?.includes("Math.min(50")) {
  throw new Error("page_size clamp missing");
}

const ops = Object.entries(files).map(([path, content]) =>
  sandbox.exists(path)
    ? { type: "write", path, content }
    : { type: "add", path, content },
);
sandbox.apply(ops);

console.log("DDB smoke passed.", {
  packageJsonPatched: ensured.packageJsonPatched,
  filesCopied: ensured.filesCopied.length,
  generated: Object.keys(files).length,
});
