/** 解析 Agent 传入的 JSON 对象（兼容误传 JSON 字符串） */
export function parseDynamicDbJsonObject(
  value: unknown,
): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

const METADATA_KEYS = new Set([
  "title",
  "version",
  "$schema",
  "$id",
  "description",
]);

function looksLikeJsonSchemaObject(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return row.type === "object" || typeof row.properties === "object";
}

/** Agent 常把 kind 直接放在 rootSchema 顶层，自动包一层 collections */
export function wrapBareKindSchemasIntoCollections(
  obj: Record<string, unknown>,
): Record<string, unknown> | null {
  if (obj.collections && typeof obj.collections === "object") {
    return obj;
  }

  const kindEntries = Object.entries(obj).filter(
    ([key, value]) => !METADATA_KEYS.has(key) && looksLikeJsonSchemaObject(value),
  );
  if (kindEntries.length === 0) return null;

  return {
    ...Object.fromEntries(
      Object.entries(obj).filter(([key]) => METADATA_KEYS.has(key)),
    ),
    collections: Object.fromEntries(kindEntries),
  };
}

function unwrapNestedSchemaContainer(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  let current = obj;
  for (let depth = 0; depth < 4; depth++) {
    const nested =
      (current.root_schema &&
      typeof current.root_schema === "object" &&
      !Array.isArray(current.root_schema)
        ? (current.root_schema as Record<string, unknown>)
        : null) ??
      (current.rootSchema &&
      typeof current.rootSchema === "object" &&
      !Array.isArray(current.rootSchema)
        ? (current.rootSchema as Record<string, unknown>)
        : null);

    if (!nested) break;
    current = nested;
  }
  return current;
}

/**
 * activateSchema → POST /p/{id}/schema
 * Body 顶层必须是 `{ collections: { [kind]: jsonSchema } }`（可含 version 等）。
 */
export function normalizeDynamicDbActivateBody(
  value: unknown,
): Record<string, unknown> | null {
  const obj = parseDynamicDbJsonObject(value);
  if (!obj) return null;

  const unwrapped = unwrapNestedSchemaContainer(obj);
  const withCollections =
    wrapBareKindSchemasIntoCollections(unwrapped) ?? unwrapped;

  if (
    withCollections.collections &&
    typeof withCollections.collections === "object"
  ) {
    return withCollections;
  }

  return null;
}

/**
 * initializeProject → POST /p/{id}/initialize
 * Body 必须是 `{ root_schema: { collections: ... } }`（可含 seed 等）。
 */
export function normalizeDynamicDbInitializeBody(
  rootSchema: unknown,
  initializeBody: unknown,
): Record<string, unknown> | null {
  const fromBody = parseDynamicDbJsonObject(initializeBody);
  if (fromBody) {
    const unwrapped = unwrapNestedSchemaContainer(fromBody);
    if (
      unwrapped.root_schema &&
      typeof unwrapped.root_schema === "object" &&
      !Array.isArray(unwrapped.root_schema)
    ) {
      return unwrapped;
    }
    const withCollections = wrapBareKindSchemasIntoCollections(unwrapped);
    if (withCollections?.collections) {
      return { root_schema: withCollections };
    }
    return unwrapped;
  }

  const fromRoot = normalizeDynamicDbActivateBody(rootSchema);
  if (!fromRoot) return null;
  return { root_schema: fromRoot };
}

/** getSchema 响应是否尚未 initialize（平台新建 DDB 项目默认为 true） */
export function schemaNeedsInitialize(schemaResponse: unknown): boolean {
  if (!schemaResponse || typeof schemaResponse !== "object") return true;
  const row = schemaResponse as Record<string, unknown>;
  const jsonSchema = row.json_schema;
  if (!jsonSchema || typeof jsonSchema !== "object") return true;
  const collections = (jsonSchema as Record<string, unknown>).collections;
  if (!collections || typeof collections !== "object") return true;
  return Object.keys(collections as object).length === 0;
}

export function formatDynamicDbSchemaValidationError(
  operation: string,
  rawRootSchema: unknown,
): string {
  const parsed = parseDynamicDbJsonObject(rawRootSchema);
  const keys =
    parsed && typeof parsed === "object"
      ? Object.keys(parsed).join(", ") || "(empty object)"
      : typeof rawRootSchema === "string"
        ? "JSON string — pass a nested object in rootSchema instead"
        : String(rawRootSchema ?? "missing");

  return (
    `${operation} 需要 rootSchema.collections（kind → JSON Schema object）。` +
    ` 收到 rootSchema 顶层键: ${keys}。` +
    " 正确示例（对象，勿 stringify）：" +
    ' rootSchema: { collections: { students: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } } } }。' +
    " 新平台项目优先用 operation: setupSchema（自动 initialize 或 activate）。"
  );
}
