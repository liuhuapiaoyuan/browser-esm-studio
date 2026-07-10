import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_AI_PROXY_TARGET || "https://api.openai.com";
  const ddbTarget =
    env.DYNAMIC_DB_BASE_URL?.trim() ||
    env.VITE_DYNAMIC_DB_BASE_URL?.trim() ||
    "https://dynamic-db.b.nps.qzsyzn.com";
  const ddbUserId =
    env.VITE_DDB_USER_ID?.trim() ||
    env.DYNAMIC_DB_USER_ID?.trim() ||
    env.DDB_USER_ID?.trim() ||
    "dev-user";
  const ddbRoles =
    env.VITE_DDB_ROLES?.trim() ||
    env.DYNAMIC_DB_USER_ROLES?.trim() ||
    env.DDB_ROLES?.trim() ||
    "admin";

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ["typescript-browser/lib/typescript.js", "@typescript/vfs"],
    },
    server: {
      port: 5173,
      proxy: {
        // Browser → /openai-proxy/v1/... → {VITE_AI_PROXY_TARGET}/v1/...
        "/openai-proxy": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (pathName) => pathName.replace(/^\/openai-proxy/, ""),
        },
        // Preview + Agent → /ddb/... → Dynamic DB provider
        "/ddb": {
          target: ddbTarget.replace(/\/$/, ""),
          changeOrigin: true,
          secure: true,
          rewrite: (pathName) => pathName.replace(/^\/ddb/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq) => {
              proxyReq.setHeader("X-User-Id", ddbUserId);
              proxyReq.setHeader("X-User-Roles", ddbRoles);
            });
          },
        },
      },
    },
  };
});
