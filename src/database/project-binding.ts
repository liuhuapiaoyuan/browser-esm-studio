import { createDynamicDbProject } from "./dynamic-db-api";

const STORAGE_KEY = "browser-esm-studio-ddb-project-v1";

export type DdbProjectBinding = {
  projectId: string;
  createdAt: string;
};

function readBinding(): DdbProjectBinding | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DdbProjectBinding;
    if (typeof parsed?.projectId === "string" && /^[a-fA-F0-9]{24}$/.test(parsed.projectId)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeBinding(binding: DdbProjectBinding): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(binding));
}

/** 已绑定的 DDB projectId；未绑定返回 null（不发起网络） */
export function getBoundDdbProjectId(): string | null {
  return readBinding()?.projectId ?? null;
}

/**
 * 确保工作区已绑定 Dynamic DB 租户。
 * 无本地 id 时 POST /projects，ObjectId 写入 localStorage。
 */
export async function ensureDdbProject(displayName = "browser-esm-studio"): Promise<string> {
  const existing = readBinding();
  if (existing) return existing.projectId;

  const row = await createDynamicDbProject(displayName);
  writeBinding({ projectId: row.id, createdAt: new Date().toISOString() });
  return row.id;
}

/** 清除本地绑定（不删除 Provider 侧项目） */
export function clearDdbProjectBinding(): void {
  localStorage.removeItem(STORAGE_KEY);
}
