import { defineConfig, loadEnv, type ProxyOptions } from "vite";
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
  const liteImageTarget = (
    env.LITE_IMAGE_PROXY_TARGET?.trim() ||
    env.VITE_LITE_IMAGE_PROXY_TARGET?.trim() ||
    "https://api.siliconflow.cn"
  ).replace(/\/$/, "");
  const liteImageApiKey =
    env.LITE_IMAGE_API_KEY?.trim() ||
    env.SILICONFLOW_API_KEY?.trim() ||
    env.VITE_LITE_IMAGE_API_KEY?.trim() ||
    env.VITE_SILICONFLOW_API_KEY?.trim() ||
    "";

  const proxy: Record<string, string | ProxyOptions> = {
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
      configure: (proxyServer) => {
        proxyServer.on("proxyReq", (proxyReq) => {
          proxyReq.setHeader("X-User-Id", ddbUserId);
          proxyReq.setHeader("X-User-Roles", ddbRoles);
        });
      },
    },
    // Browser → /lite-image-proxy/v1/... → SiliconFlow /v1/...
    "/lite-image-proxy": {
      target: liteImageTarget,
      changeOrigin: true,
      secure: true,
      rewrite: (pathName) => pathName.replace(/^\/lite-image-proxy/, ""),
      configure: (proxyServer) => {
        proxyServer.on("proxyReq", (proxyReq) => {
          if (!liteImageApiKey) return;
          if (proxyReq.getHeader("Authorization")) return;
          const value = /^Bearer\s+/i.test(liteImageApiKey)
            ? liteImageApiKey
            : `Bearer ${liteImageApiKey}`;
          proxyReq.setHeader("Authorization", value);
        });
      },
    },
  };

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ["typescript-browser/lib/typescript.js", "@typescript/vfs"],
    },
    server: {
      port: 5173,
      proxy,
    },
    preview: {
      proxy,
    },
  };
});
