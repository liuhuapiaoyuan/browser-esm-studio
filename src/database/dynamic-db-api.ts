import {
  DDB_BROWSER_BASE_URL,
  getDynamicDbUserId,
  getDynamicDbUserRoles,
} from "./dynamic-db-config";

export class DynamicDbApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "DynamicDbApiError";
  }
}

export type DynamicDbRequestAuth = {
  userId: string;
  roles?: string[];
};

function buildDynamicDbHeaders(init?: HeadersInit, auth?: DynamicDbRequestAuth): Headers {
  const headers = new Headers(init);
  headers.set("X-User-Id", auth?.userId ?? getDynamicDbUserId());
  const roles = auth?.roles ?? getDynamicDbUserRoles();
  if (roles?.length) {
    headers.set("X-User-Roles", roles.join(","));
  }
  return headers;
}

/** 浏览器一律走同源 `/ddb`（由 Vite 代理注入身份并转发 Provider） */
export async function dynamicDbFetch(
  path: string,
  init?: RequestInit,
  auth?: DynamicDbRequestAuth,
): Promise<unknown> {
  const base = DDB_BROWSER_BASE_URL.replace(/\/$/, "");
  const url = path.startsWith("http")
    ? path
    : `${base}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = buildDynamicDbHeaders(init?.headers, auth);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  } else {
    body = null;
  }

  if (!res.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : text || `HTTP ${res.status}`;
    throw new DynamicDbApiError(message, res.status, body);
  }

  return body;
}

export type DynamicDbProjectRow = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
};

/** 在 provider 创建项目，返回 24 位 ObjectId */
export async function createDynamicDbProject(name: string): Promise<DynamicDbProjectRow> {
  const body = await dynamicDbFetch("/projects", {
    method: "POST",
    body: JSON.stringify({ name, status: "active" }),
  });
  const row = body as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) {
    throw new DynamicDbApiError("Dynamic DB 未返回项目 id", 502, body);
  }
  return {
    id,
    name: typeof row.name === "string" ? row.name : name,
    slug: typeof row.slug === "string" ? row.slug : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
  };
}

export async function deleteDynamicDbProject(projectId: string): Promise<void> {
  const id = projectId.trim();
  if (!id) return;
  await dynamicDbFetch(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteDynamicDbProjectIfExists(projectId: string): Promise<void> {
  try {
    await deleteDynamicDbProject(projectId);
  } catch (e) {
    if (e instanceof DynamicDbApiError && e.status === 404) return;
    throw e;
  }
}

export async function getDynamicDbProjectSchema(
  projectId: string,
  auth?: DynamicDbRequestAuth,
): Promise<unknown> {
  return dynamicDbFetch(`/p/${encodeURIComponent(projectId)}/schema`, undefined, auth);
}

export async function getDynamicDbEffectiveSchema(
  projectId: string,
  kind: string,
): Promise<unknown> {
  const q = new URLSearchParams({ kind });
  return dynamicDbFetch(`/p/${encodeURIComponent(projectId)}/schema/effective?${q}`);
}

export async function listDynamicDbRecords(
  params: {
    projectId: string;
    kind: string;
    page?: number;
    pageSize?: number;
    filter?: Record<string, unknown>;
    populate?: boolean | string[];
  },
  auth?: DynamicDbRequestAuth,
): Promise<unknown> {
  const q = new URLSearchParams();
  if (params.page != null) q.set("page", String(params.page));
  if (params.pageSize != null) q.set("page_size", String(params.pageSize));
  if (params.filter && Object.keys(params.filter).length > 0) {
    q.set("filter", JSON.stringify(params.filter));
  }
  if (params.populate === true) {
    q.set("populate", "true");
  } else if (Array.isArray(params.populate) && params.populate.length > 0) {
    q.set("populate", params.populate.join(","));
  }
  const qs = q.toString();
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records${qs ? `?${qs}` : ""}`,
    undefined,
    auth,
  );
}

export async function getDynamicDbRecord(params: {
  projectId: string;
  kind: string;
  recordId: string;
  populate?: boolean;
}): Promise<unknown> {
  const q = params.populate ? "?populate=true" : "";
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records/${encodeURIComponent(params.recordId)}${q}`,
  );
}

export async function createDynamicDbRecord(params: {
  projectId: string;
  kind: string;
  payload: Record<string, unknown>;
}): Promise<unknown> {
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records`,
    { method: "POST", body: JSON.stringify(params.payload) },
  );
}

export async function updateDynamicDbRecord(params: {
  projectId: string;
  kind: string;
  recordId: string;
  payload: Record<string, unknown>;
}): Promise<unknown> {
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records/${encodeURIComponent(params.recordId)}`,
    { method: "PATCH", body: JSON.stringify(params.payload) },
  );
}

export async function deleteDynamicDbRecord(params: {
  projectId: string;
  kind: string;
  recordId: string;
  cascade?: boolean;
}): Promise<unknown> {
  return dynamicDbFetch("/agent/records-delete", {
    method: "POST",
    body: JSON.stringify({
      operation: "recordsDelete",
      projectId: params.projectId,
      kind: params.kind,
      recordId: params.recordId,
      ...(params.cascade ? { cascade: 1 } : {}),
    }),
  });
}

export async function dynamicDbRecordsBatch(body: Record<string, unknown>): Promise<unknown> {
  return dynamicDbFetch("/agent/records-batch", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function countDynamicDbRecords(params: {
  projectId: string;
  kind: string;
  filter?: Record<string, unknown>;
}): Promise<unknown> {
  const q = new URLSearchParams();
  if (params.filter && Object.keys(params.filter).length > 0) {
    q.set("filter", JSON.stringify(params.filter));
  }
  const qs = q.toString();
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records/count${qs ? `?${qs}` : ""}`,
  );
}

export async function upsertDynamicDbRecord(params: {
  projectId: string;
  kind: string;
  where: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}): Promise<unknown> {
  return dynamicDbFetch(
    `/p/${encodeURIComponent(params.projectId)}/collections/${encodeURIComponent(params.kind)}/records/upsert`,
    {
      method: "POST",
      body: JSON.stringify({
        where: params.where,
        create: params.create,
        update: params.update,
      }),
    },
  );
}

export async function activateDynamicDbSchema(
  projectId: string,
  rootSchema: Record<string, unknown>,
): Promise<unknown> {
  return dynamicDbFetch(`/p/${encodeURIComponent(projectId)}/schema`, {
    method: "POST",
    body: JSON.stringify(rootSchema),
  });
}

export async function initializeDynamicDbProject(
  projectId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  return dynamicDbFetch(`/p/${encodeURIComponent(projectId)}/initialize`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getDynamicDbInventory(): Promise<unknown> {
  return dynamicDbFetch("/me/inventory");
}
