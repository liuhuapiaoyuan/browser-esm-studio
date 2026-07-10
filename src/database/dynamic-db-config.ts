/** Dynamic DB provider 根地址（Vite 代理目标；浏览器侧请求走 `/ddb`） */
export const DYNAMIC_DB_BASE_URL =
  (import.meta.env.VITE_DYNAMIC_DB_BASE_URL as string | undefined)?.trim() ||
  "https://dynamic-db.b.nps.qzsyzn.com";

/** 浏览器 / Preview 同源代理前缀 */
export const DDB_BROWSER_BASE_URL = "/ddb";

export const DEFAULT_DYNAMIC_DB_USER_ROLES = ["admin"] as const;

function parseDynamicDbRoles(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const roles = raw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : undefined;
}

export function getDynamicDbUserId(): string {
  return (
    (import.meta.env.VITE_DDB_USER_ID as string | undefined)?.trim() ||
    (import.meta.env.VITE_DYNAMIC_DB_USER_ID as string | undefined)?.trim() ||
    "dev-user"
  );
}

export function getDynamicDbUserRoles(): string[] | undefined {
  return parseDynamicDbRoles(
    (import.meta.env.VITE_DDB_ROLES as string | undefined)?.trim() ||
      (import.meta.env.VITE_DYNAMIC_DB_USER_ROLES as string | undefined)?.trim(),
  );
}

/** 解析 Dynamic DB 角色：env → override → 默认 admin */
export function resolveDynamicDbUserRoles(override?: string[] | null): string[] {
  if (override?.length) return override;
  return getDynamicDbUserRoles() ?? [...DEFAULT_DYNAMIC_DB_USER_ROLES];
}
