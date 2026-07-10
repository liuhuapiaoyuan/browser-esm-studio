import {
  emitKindDelegateModule,
  emitKindTypes,
  emitKindTypesModule,
  emitDelegatesBarrel,
  emitIndexFile,
  emitTypesBarrel,
  type KindTypeBundle,
} from "../../node_modules/@qzsy/dynamic-db-cli/dist/schema-to-ts.js";
import type { JsonSchemaObject, RootSchema } from "@qzsy/dynamic-db-client";
import { getDynamicDbProjectSchema } from "./dynamic-db-api";

const PAGE_SIZE_PATTERN = /page_size: args\.pageSize \?\? 20/g;
const PAGE_SIZE_REPLACEMENT = "page_size: Math.min(50, args.pageSize ?? 20)";

function kindFileBase(kind: string): string {
  return kind.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extractRootSchema(schemaResponse: unknown): RootSchema {
  if (!schemaResponse || typeof schemaResponse !== "object") {
    return { collections: {} };
  }
  const row = schemaResponse as Record<string, unknown>;
  const jsonSchema = row.json_schema;
  if (jsonSchema && typeof jsonSchema === "object" && !Array.isArray(jsonSchema)) {
    const collections = (jsonSchema as Record<string, unknown>).collections;
    if (collections && typeof collections === "object") {
      return { collections: collections as RootSchema["collections"] };
    }
  }
  if (row.collections && typeof row.collections === "object") {
    return { collections: row.collections as RootSchema["collections"] };
  }
  return { collections: {} };
}

function clampPageSize(source: string): string {
  return source.replace(PAGE_SIZE_PATTERN, PAGE_SIZE_REPLACEMENT);
}

function bundlesFromRoot(root: RootSchema): KindTypeBundle[] {
  const collections = root.collections ?? {};
  return Object.keys(collections).map((kind) =>
    emitKindTypes(kind, collections[kind] as JsonSchemaObject),
  );
}

/** 根据 RootSchema 生成虚拟项目 `src/ddb/generated/*` 文件 map */
export function generateDdbFilesFromRoot(
  root: RootSchema,
  meta: { projectId: string; schemaVersion: number },
): Record<string, string> {
  const bundles = bundlesFromRoot(root);
  const files: Record<string, string> = {
    "src/ddb/generated/types.ts": emitTypesBarrel(bundles),
    "src/ddb/generated/delegates.ts": emitDelegatesBarrel(bundles),
    "src/ddb/generated/index.ts": emitIndexFile(bundles),
    "src/ddb/generated/meta.json": JSON.stringify(
      {
        projectId: meta.projectId,
        schemaVersion: meta.schemaVersion,
        generatedAt: new Date().toISOString(),
        kinds: bundles.map((b) => b.kind),
        generator: "@qzsy/dynamic-db-cli (host)",
        layout: "kinds-v1",
      },
      null,
      2,
    ),
    "src/ddb/generated/schema.snapshot.json": JSON.stringify(root, null, 2),
    "src/ddb/generated/kinds/.gitkeep": "",
  };

  for (const bundle of bundles) {
    const base = kindFileBase(bundle.kind);
    files[`src/ddb/generated/kinds/${base}.types.ts`] = emitKindTypesModule(bundle);
    files[`src/ddb/generated/kinds/${base}.delegate.ts`] = clampPageSize(
      emitKindDelegateModule(bundle),
    );
  }

  return files;
}

/** 拉取项目 schema 并生成 generated 文件 */
export async function codegenDdbProjectFiles(projectId: string): Promise<{
  files: Record<string, string>;
  kindNames: string[];
  schemaVersion: number;
}> {
  const schemaResponse = await getDynamicDbProjectSchema(projectId);
  const root = extractRootSchema(schemaResponse);
  const version =
    schemaResponse &&
    typeof schemaResponse === "object" &&
    typeof (schemaResponse as { version?: unknown }).version === "number"
      ? (schemaResponse as { version: number }).version
      : 0;

  const files = generateDdbFilesFromRoot(root, {
    projectId,
    schemaVersion: version,
  });
  const kindNames = Object.keys(root.collections ?? {});
  return { files, kindNames, schemaVersion: version };
}

/** 空 schema 占位 generated（ensure stack 用） */
export function emptyGeneratedDdbFiles(): Record<string, string> {
  return generateDdbFilesFromRoot(
    { collections: {} },
    { projectId: "", schemaVersion: 0 },
  );
}
