/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_BASE_URL?: string;
  readonly VITE_AI_API_KEY?: string;
  readonly VITE_AI_MODEL?: string;
  readonly VITE_AI_PROXY_TARGET?: string;
  readonly VITE_DYNAMIC_DB_BASE_URL?: string;
  readonly VITE_DDB_USER_ID?: string;
  readonly VITE_DYNAMIC_DB_USER_ID?: string;
  readonly VITE_DDB_ROLES?: string;
  readonly VITE_DYNAMIC_DB_USER_ROLES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.md?raw" {
  const content: string;
  export default content;
}
