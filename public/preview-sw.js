const CACHE_NAME = "browser-esm-studio-v3";
const PREVIEW_PREFIX = "/__preview__/";
const SOURCE_PREFIX = "/__preview_source__/";
const SUCRASE_URL = "/sucrase.browser.js";

let sucrasePromise;

self.addEventListener("install", (event) => {
  event.waitUntil(
    loadSucrase()
      .catch((error) => console.error("[preview-sw] Sucrase preload failed:", error))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("message", (event) => {
  const reply = event.ports?.[0];

  if (event.data?.type === "CLAIM_CLIENTS") {
    event.waitUntil(
      self.clients.claim()
        .then(() => reply?.postMessage({ ok: true }))
        .catch((error) => reply?.postMessage({ ok: false, error: error.message })),
    );
    return;
  }

  if (event.data?.type !== "SYNC_PREVIEW_PROJECT") return;

  event.waitUntil(
    persistProject(event.data.sessionId, event.data.files)
      .then(() => reply?.postMessage({ ok: true }))
      .catch((error) => reply?.postMessage({ ok: false, error: error.message })),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREVIEW_PREFIX)) return;
  event.respondWith(handlePreviewRequest(url));
});

function cleanPath(value) {
  const output = [];
  for (const part of decodeURIComponent(value).replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") output.pop();
    else output.push(part);
  }
  return output.join("/");
}

function sourceUrl(sessionId, path) {
  const encodedPath = cleanPath(path).split("/").map(encodeURIComponent).join("/");
  return new URL(`${SOURCE_PREFIX}${encodeURIComponent(sessionId)}/${encodedPath}`, self.location.origin).href;
}

async function persistProject(sessionId, files) {
  if (!sessionId || typeof files !== "object" || !files) {
    throw new Error("无效的 Preview 项目数据。");
  }

  const cache = await caches.open(CACHE_NAME);
  const prefix = sourceUrl(sessionId, "");
  const existing = await cache.keys();
  await Promise.all(existing.filter((request) => request.url.startsWith(prefix)).map((request) => cache.delete(request)));

  await Promise.all(
    Object.entries(files).map(([path, source]) =>
      cache.put(
        sourceUrl(sessionId, path),
        new Response(String(source), {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
      ),
    ),
  );
}

async function readSource(sessionId, path) {
  const cache = await caches.open(CACHE_NAME);
  const candidates = [
    path,
    `${path}.tsx`,
    `${path}.ts`,
    `${path}.jsx`,
    `${path}.js`,
    `${path}.mjs`,
    `${path}.css`,
    `${path}.json`,
    `${path}/index.tsx`,
    `${path}/index.ts`,
    `${path}/index.jsx`,
    `${path}/index.js`,
    `${path}/index.mjs`,
  ];

  for (const candidate of candidates) {
    const response = await cache.match(sourceUrl(sessionId, candidate));
    if (response) return { path: cleanPath(candidate), source: await response.text() };
  }

  return null;
}

function responseHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

function mimeType(path) {
  const extension = path.split(".").pop()?.toLowerCase();
  return {
    html: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    jsx: "text/javascript; charset=utf-8",
    ts: "text/javascript; charset=utf-8",
    tsx: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8",
    json: "application/json; charset=utf-8",
    svg: "image/svg+xml",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
  }[extension] || "application/octet-stream";
}

function isScriptModule(path) {
  return /\.(?:m?[jt]sx?)$/i.test(path);
}

function needsTranspile(path) {
  return /\.(?:tsx|ts|jsx)$/i.test(path);
}

async function loadSucrase() {
  if (globalThis.Sucrase?.transform) return globalThis.Sucrase;
  if (sucrasePromise) return sucrasePromise;

  sucrasePromise = (async () => {
    const url = new URL(SUCRASE_URL, self.location.origin).href;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Sucrase 加载失败: HTTP ${response.status} (${url})`);
    }

    const code = await response.text();
    // Indirect eval runs in the worker global scope (classic SW cannot use import()).
    (0, eval)(`${code}\n;globalThis.Sucrase = globalThis.Sucrase || Sucrase;`);

    if (!globalThis.Sucrase?.transform) {
      throw new Error("Sucrase 已加载但未暴露 transform API。");
    }
    return globalThis.Sucrase;
  })().catch((error) => {
    sucrasePromise = undefined;
    throw error;
  });

  return sucrasePromise;
}

async function transpileModule(source, path) {
  if (!needsTranspile(path)) return source;

  const runtime = await loadSucrase();
  const transforms = ["typescript"];
  if (/\.(?:tsx|jsx)$/i.test(path)) transforms.push("jsx");

  try {
    return runtime.transform(source, {
      transforms,
      jsxRuntime: "automatic",
      production: false,
      filePath: path,
    }).code;
  } catch (error) {
    throw new Error(`转译失败 ${path}: ${error.message}`);
  }
}

const TAILWIND_BROWSER_SCRIPT =
  '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>';

function pinVersion(rawVersion) {
  return String(rawVersion || "latest").replace(/^[~^]/, "") || "latest";
}

function isBrowserRuntimePackage(name) {
  if (name.startsWith("@types/")) return false;
  if (name.startsWith("@vitejs/")) return false;
  if (name.startsWith("@tailwindcss/")) return false;
  return !["typescript", "vite", "esbuild", "rollup", "tsc", "tailwindcss"].includes(name);
}

function dependencyMap(packageSource) {
  try {
    const manifest = JSON.parse(packageSource);
    // Only runtime dependencies are mapped into the browser; build tooling stays out.
    const dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies || {}).filter(([name]) => isBrowserRuntimePackage(name)),
    );
    const imports = {};

    const pins = {};
    for (const [name, rawVersion] of Object.entries(dependencies)) {
      pins[name] = pinVersion(rawVersion);
    }

    // Always expose React / ReactDOM when present so TSX automatic runtime can resolve.
    const sharedDependencies = ["react", "react-dom", "preact", "vue", "svelte"]
      .filter((name) => pins[name])
      .map((name) => `${name}@${pins[name]}`)
      .join(",");

    for (const [name, rawVersion] of Object.entries(dependencies)) {
      const version = pinVersion(rawVersion);
      const target = `https://esm.sh/${name}@${version}`;
      const isSharedRuntime = ["react", "react-dom", "preact", "vue", "svelte"].includes(name);
      const params = ["dev", "target=es2022"];
      if (sharedDependencies && !isSharedRuntime) params.push(`deps=${sharedDependencies}`);

      imports[name] = `${target}?${params.join("&")}`;
      // esm.sh documents the `&dev/` form specifically for import-map prefix entries.
      imports[`${name}/`] = `${target}&dev&target=es2022/`;
    }

    return imports;
  } catch {
    return {};
  }
}

/** Map tsconfig paths like "@/*" → ["./src/*"] into import-map prefixes ("@/" → "./src/"). */
function pathAliasImports(tsconfigSource) {
  try {
    const config = JSON.parse(tsconfigSource);
    const paths = config?.compilerOptions?.paths;
    if (!paths || typeof paths !== "object") return {};

    const imports = {};
    for (const [pattern, targets] of Object.entries(paths)) {
      if (!pattern.endsWith("/*")) continue;
      const targetList = Array.isArray(targets) ? targets : [targets];
      const mapped = targetList.find((item) => typeof item === "string" && item.endsWith("/*"));
      if (!mapped) continue;

      const prefix = pattern.slice(0, -1); // "@/*" → "@/"
      let dest = mapped.slice(0, -1); // "./src/*" → "./src/"
      if (!dest.startsWith("./") && !dest.startsWith("../")) dest = `./${dest}`;
      imports[prefix] = dest;
    }
    return imports;
  } catch {
    return {};
  }
}

function packageUsesTailwind(packageSource) {
  try {
    const manifest = JSON.parse(packageSource);
    const all = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
    return Boolean(
      all.tailwindcss || all["@tailwindcss/vite"] || all["@tailwindcss/browser"],
    );
  } catch {
    return false;
  }
}

function cssLooksLikeTailwind(source) {
  return /@import\s+["']tailwindcss["']|@theme\b|@tailwind\b|@config\b|@plugin\b|@source\b/.test(
    source,
  );
}

async function projectUsesTailwind(sessionId, packageSource) {
  if (packageUsesTailwind(packageSource)) return true;

  const cache = await caches.open(CACHE_NAME);
  const prefix = sourceUrl(sessionId, "");
  const keys = await cache.keys();
  for (const request of keys) {
    if (!request.url.startsWith(prefix) || !request.url.endsWith(".css")) continue;
    const response = await cache.match(request);
    if (!response) continue;
    if (cssLooksLikeTailwind(await response.text())) return true;
  }
  return false;
}

/** Strip Vite-only Tailwind entry imports; the browser runtime supplies the engine. */
function prepareTailwindCss(source) {
  return source
    .replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["']\s*;?/g, "")
    .replace(/@import\s+["']tailwindcss(?:\/[^"']*)?["']\s+layer\([^)]+\)\s*;?/g, "")
    .trim();
}

function bridgeScript() {
  return `<script>
  (() => {
    const send = (type, payload) => parent.postMessage({ source: "browser-esm-preview", type, payload }, "*");
    const normalize = (value) => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === "string") return value;
      try { return JSON.stringify(value); } catch { return String(value); }
    };
    for (const level of ["log", "info", "warn", "error"]) {
      const original = console[level].bind(console);
      console[level] = (...args) => { original(...args); send("console", { level, args: args.map(normalize) }); };
    }
    addEventListener("error", (event) => send("error", {
      message: event.error?.message || event.message || ("Script error" + (event.filename ? (" at " + event.filename) : "")),
      stack: event.error?.stack || "",
    }));
    addEventListener("unhandledrejection", (event) => send("error", { message: normalize(event.reason), stack: event.reason?.stack || "" }));
    addEventListener("DOMContentLoaded", () => send("ready", { title: document.title }));
  })();
  </script>`;
}

// Root-absolute URLs ignore <base href>; make them relative so preview scope applies.
function rewriteRootAbsoluteUrls(source) {
  return source.replace(/\b(src|href)=(["'])\/(?!\/)/gi, "$1=$2");
}

async function transformHtml(sessionId, source) {
  const packageFile = await readSource(sessionId, "package.json");
  const packageSource = packageFile?.source || "{}";
  const tsconfigFile = await readSource(sessionId, "tsconfig.json");
  const imports = {
    ...dependencyMap(packageSource),
    ...pathAliasImports(tsconfigFile?.source || "{}"),
  };
  const useTailwind = await projectUsesTailwind(sessionId, packageSource);
  const base = `<base href="${PREVIEW_PREFIX}${encodeURIComponent(sessionId)}/">`;
  const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
  const tailwindScript = useTailwind ? TAILWIND_BROWSER_SCRIPT : "";
  const injection = `${base}${importMap}${tailwindScript}${bridgeScript()}`;
  const html = rewriteRootAbsoluteUrls(source);

  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${injection}`);
  }
  return `${injection}${html}`;
}

function rewriteCssImports(source) {
  const staticImport = /(\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?)(["'])([^"']+\.css)(\2)/g;
  const dynamicImport = /(\bimport\s*\(\s*)(["'])([^"']+\.css)(\2)(\s*\))/g;
  return source
    .replace(staticImport, (_, prefix, quote, specifier) => `${prefix}${quote}${specifier}?__preview_css__${quote}`)
    .replace(dynamicImport, (_, prefix, quote, specifier, _closingQuote, suffix) => `${prefix}${quote}${specifier}?__preview_css__${quote}${suffix}`);
}

function cssModule(source, path) {
  const id = `preview-style-${path.replace(/[^a-z0-9_-]/gi, "-")}`;
  const isTailwind = cssLooksLikeTailwind(source);
  const css = isTailwind ? prepareTailwindCss(source) : source;
  const typeLine = isTailwind ? 'style.type = "text/tailwindcss";\n' : "";
  return `const css = ${JSON.stringify(css)};
let style = document.getElementById(${JSON.stringify(id)});
if (!style) {
  style = document.createElement("style");
  style.id = ${JSON.stringify(id)};
${typeLine}  document.head.appendChild(style);
}
style.textContent = css;
export default css;`;
}

async function handlePreviewRequest(url) {
  const remainder = url.pathname.slice(PREVIEW_PREFIX.length);
  const slash = remainder.indexOf("/");
  const sessionId = slash === -1 ? remainder : remainder.slice(0, slash);
  const requestedPath = cleanPath(slash === -1 ? "index.html" : remainder.slice(slash + 1)) || "index.html";

  try {
    const file = await readSource(sessionId, requestedPath);

    if (!file) {
      return new Response(`Virtual file not found: ${requestedPath}`, {
        status: 404,
        headers: responseHeaders("text/plain; charset=utf-8"),
      });
    }

    let source = file.source;
    let type = mimeType(file.path);

    if (file.path.endsWith(".html")) source = await transformHtml(sessionId, source);
    if (isScriptModule(file.path)) {
      source = await transpileModule(source, file.path);
      source = rewriteCssImports(source);
      type = "text/javascript; charset=utf-8";
    }
    if (url.searchParams.has("__preview_css__") && file.path.endsWith(".css")) {
      source = cssModule(source, file.path);
      type = "text/javascript; charset=utf-8";
    }

    return new Response(source, { headers: responseHeaders(type) });
  } catch (error) {
    const message = error.message || String(error);
    // Return executable JS so the iframe loads the module, throws, and the bridge
    // forwards the real transpile/runtime message into the host console.
    // Plain-text 500 bodies are swallowed as MIME/module load failures.
    if (!/\.(?:html|css|json|svg|txt|md)$/i.test(requestedPath)) {
      return new Response(`throw new Error(${JSON.stringify(message)});`, {
        status: 200,
        headers: responseHeaders("text/javascript; charset=utf-8"),
      });
    }
    return new Response(message, {
      status: 500,
      headers: responseHeaders("text/plain; charset=utf-8"),
    });
  }
}
