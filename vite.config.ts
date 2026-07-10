import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.VITE_AI_PROXY_TARGET || "https://api.openai.com";

  return {
    plugins: [react()],
    optimizeDeps: {
      include: ["typescript-browser/lib/typescript.js", "@typescript/vfs"],
    },
    server: {
      port: 5173,
      proxy: {
        // Browser → /openai-proxy/v1/... → {VITE_AI_PROXY_TARGET}/v1/...
        // Avoids CORS when calling ChatGPT-compatible APIs from the browser.
        "/openai-proxy": {
          target: proxyTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/openai-proxy/, ""),
        },
      },
    },
  };
});
