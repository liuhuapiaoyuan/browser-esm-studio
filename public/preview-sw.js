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
  event.respondWith(handlePreviewRequest(url, event.request));
});

/** Document navigations (refresh / open) to client routes need index.html. */
function isDocumentRequest(request) {
  if (!request) return false;
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

/** Paths without a file extension are treated as SPA routes (/gomoku, /users/1). */
function isSpaRoutePath(path) {
  return !path || !/\.[a-z0-9]+$/i.test(path);
}

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

  // NodeNext / TypeScript: import './foo.js' resolves to foo.ts on disk.
  if (/\.js$/i.test(path)) {
    const base = path.slice(0, -3);
    candidates.push(`${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.mjs`);
  } else if (/\.mjs$/i.test(path)) {
    const base = path.slice(0, -4);
    candidates.push(`${base}.mts`, `${base}.ts`);
  }

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

const DEFAULT_REACT_VERSION = "19.2.7";

function packageReactVersion(packageSource) {
  try {
    const react = JSON.parse(packageSource)?.dependencies?.react;
    if (react) return pinVersion(react);
  } catch {
    /* ignore */
  }
  return DEFAULT_REACT_VERSION;
}

/** Sucrase automatic JSX emits bare "react/jsx-dev-runtime"; pin to esm.sh so Preview
 *  does not depend on import-map prefix matching (aliases / missing react / stale SW). */
function rewriteAutomaticJsxImports(code, reactVersion) {
  const version = reactVersion || DEFAULT_REACT_VERSION;
  const query = "dev&target=es2022";
  const pairs = [
    ["react/jsx-dev-runtime", `https://esm.sh/react@${version}/jsx-dev-runtime?${query}`],
    ["react/jsx-runtime", `https://esm.sh/react@${version}/jsx-runtime?${query}`],
  ];
  let out = code;
  for (const [bare, url] of pairs) {
    out = out.replaceAll(JSON.stringify(bare), JSON.stringify(url));
    out = out.replaceAll(`'${bare}'`, `'${url}'`);
  }
  return out;
}

async function transpileModule(source, path, reactVersion) {
  if (!needsTranspile(path)) return source;

  const runtime = await loadSucrase();
  const transforms = ["typescript"];
  const isJsx = /\.(?:tsx|jsx)$/i.test(path);
  if (isJsx) transforms.push("jsx");

  try {
    let code = runtime.transform(source, {
      transforms,
      jsxRuntime: "automatic",
      production: false,
      filePath: path,
    }).code;
    if (isJsx) code = rewriteAutomaticJsxImports(code, reactVersion);
    return code;
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

/**
 * esm.sh `?dev` CJS→ESM interop drops named exports on react-reconciler/constants
 * (e.g. ConcurrentRoot). Skip `dev` for the reconciler and packages that pull it in,
 * so transitive rewrites stay on the production build.
 */
function esmShUseDev(name) {
  if (name === "react-reconciler" || name === "its-fine") return false;
  if (name.startsWith("@react-three/")) return false;
  if (name === "@pixi/react" || name === "@react-pdf/renderer") return false;
  return true;
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

    // Singleton runtimes must be pinned via ?deps so esm.sh does not pull a second copy
    // (ReactCurrentBatchConfig / "Multiple instances of Three.js").
    const sharedRuntimeNames = ["react", "react-dom", "preact", "vue", "svelte", "three"];
    const sharedDependencies = sharedRuntimeNames
      .filter((name) => pins[name])
      .map((name) => `${name}@${pins[name]}`)
      .join(",");

    for (const [name, rawVersion] of Object.entries(dependencies)) {
      const version = pinVersion(rawVersion);
      const target = `https://esm.sh/${name}@${version}`;
      const isSharedRuntime = sharedRuntimeNames.includes(name);
      const useDev = esmShUseDev(name);
      const params = ["target=es2022"];
      if (useDev) params.unshift("dev");
      if (sharedDependencies && !isSharedRuntime) params.push(`deps=${sharedDependencies}`);

      imports[name] = `${target}?${params.join("&")}`;
      // esm.sh documents the `&dev/` form specifically for import-map prefix entries.
      const prefixParams = useDev ? "&dev&target=es2022" : "&target=es2022";
      const prefixDeps =
        sharedDependencies && !isSharedRuntime ? `&deps=${sharedDependencies}` : "";
      imports[`${name}/`] = `${target}${prefixParams}${prefixDeps}/`;
    }

    // Exact subpaths — do not rely only on "react/" prefix (tsconfig "react/*" aliases can clobber it).
    if (pins.react) {
      const q = esmShUseDev("react") ? "dev&target=es2022" : "target=es2022";
      imports["react/jsx-runtime"] = `https://esm.sh/react@${pins.react}/jsx-runtime?${q}`;
      imports["react/jsx-dev-runtime"] = `https://esm.sh/react@${pins.react}/jsx-dev-runtime?${q}`;
    }
    if (pins["react-dom"]) {
      const q = esmShUseDev("react-dom") ? "dev&target=es2022" : "target=es2022";
      imports["react-dom/client"] = `https://esm.sh/react-dom@${pins["react-dom"]}/client?${q}`;
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
    // BrowserRouter basename so <Link to="/gomoku"> stays under /__preview__/{session}/
    const previewBase = location.pathname.match(/^(\\/__preview__\\/[^/]+)/);
    window.__PREVIEW_BASENAME__ = previewBase ? previewBase[1] : "";
    const send = (type, payload) => {
      try { parent.postMessage({ source: "browser-esm-preview", type, payload }, "*"); } catch (_) {}
    };
    const normalize = (value) => {
      if (value instanceof Error) return value.stack || value.message || String(value);
      if (typeof value === "string") return value;
      if (typeof value === "undefined") return "undefined";
      if (typeof value === "symbol") return value.toString();
      if (value && typeof value === "object") {
        if (typeof value.message === "string") return value.stack || value.message;
        try { return JSON.stringify(value); } catch (_) { return Object.prototype.toString.call(value); }
      }
      try { return String(value); } catch (_) { return "[unserializable]"; }
    };
    const forwardError = (message, stack) => {
      send("error", { message: message || "Unknown error", stack: stack || "" });
    };
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const original = console[level] ? console[level].bind(console) : null;
      console[level] = (...args) => {
        try { original?.(...args); } catch (_) {}
        const mapped = level === "debug" ? "log" : level;
        send("console", { level: mapped, args: args.map(normalize) });
      };
    }
    // Capture phase so we still see errors stopped by other listeners / frameworks.
    addEventListener("error", (event) => {
      const msg = event.error?.message || event.message ||
        (event.filename ? ("Resource/script error at " + event.filename) : "Script error");
      const stack = event.error?.stack ||
        (event.filename ? (event.filename + ":" + event.lineno + ":" + event.colno) : "");
      forwardError(msg, stack);
    }, true);
    addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      forwardError(normalize(reason), reason && reason.stack ? reason.stack : "");
    }, true);
    const prevOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      forwardError(
        (error && error.message) || String(message),
        (error && error.stack) || (source ? (source + ":" + lineno + ":" + colno) : ""),
      );
      if (typeof prevOnError === "function") return prevOnError(message, source, lineno, colno, error);
      return false;
    };
    const prevOnRejection = window.onunhandledrejection;
    window.onunhandledrejection = (event) => {
      forwardError(normalize(event.reason), event.reason && event.reason.stack ? event.reason.stack : "");
      if (typeof prevOnRejection === "function") return prevOnRejection.call(window, event);
    };
    // Bridge installed — host can start the settle timer; DOM ready follows for title.
    send("ready", { title: document.title, phase: "bridge" });
    addEventListener("DOMContentLoaded", () => send("ready", { title: document.title, phase: "dom" }));

    // ponytail: iframe pick mode — host toggles via postMessage; no react-grab (no source maps in SW preview)
    let pickOn = false;
    let hoverEl = null;
    const box = document.createElement("div");
    box.setAttribute("data-preview-pick", "1");
    Object.assign(box.style, {
      position: "fixed", pointerEvents: "none", zIndex: "2147483647",
      border: "2px solid #5b8cff", background: "rgba(91,140,255,.12)",
      borderRadius: "4px", display: "none", boxSizing: "border-box",
    });
    const ensureBox = () => { if (!box.isConnected) document.documentElement.appendChild(box); };
    const placeBox = (el) => {
      if (!el || el === document.documentElement || el === document.body) { box.style.display = "none"; return; }
      const r = el.getBoundingClientRect();
      Object.assign(box.style, {
        display: "block", top: r.top + "px", left: r.left + "px",
        width: Math.max(r.width, 2) + "px", height: Math.max(r.height, 2) + "px",
      });
    };
    const cssPath = (el) => {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        if (node.id) { parts.unshift("#" + CSS.escape(node.id)); break; }
        let part = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => c.tagName === node.tagName);
          if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
        const cls = [...(node.classList || [])].slice(0, 3).map((c) => CSS.escape(c)).join(".");
        if (cls) part += "." + cls;
        parts.unshift(part);
        if (node === document.body) break;
        node = parent;
      }
      return parts.join(" > ");
    };
    const reactName = (el) => {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
      if (!key) return "";
      let fiber = el[key];
      for (let i = 0; i < 12 && fiber; i += 1) {
        const t = fiber.type;
        if (typeof t === "function" && t.name && t.name !== "Fragment") return t.name;
        if (t && typeof t === "object" && (t.displayName || t.name)) return t.displayName || t.name;
        fiber = fiber.return;
      }
      return "";
    };
    const describe = (el) => {
      const html = (el.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 1800);
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || "",
        className: typeof el.className === "string" ? el.className : "",
        text: (el.innerText || "").trim().slice(0, 240),
        selector: cssPath(el),
        component: reactName(el),
        html,
      };
    };
    const setPick = (on) => {
      pickOn = !!on;
      document.documentElement.style.cursor = pickOn ? "crosshair" : "";
      if (!pickOn) { hoverEl = null; box.style.display = "none"; }
      else ensureBox();
    };
    addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "browser-esm-studio") return;
      if (data.type === "pick-mode") setPick(data.enabled);
    });
    addEventListener("pointermove", (event) => {
      if (!pickOn) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === box || el.getAttribute?.("data-preview-pick")) return;
      hoverEl = el;
      placeBox(el);
    }, true);
    addEventListener("click", (event) => {
      if (!pickOn) return;
      event.preventDefault();
      event.stopPropagation();
      const el = hoverEl || document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === document.documentElement || el === document.body) return;
      send("element-picked", describe(el));
      setPick(false);
    }, true);
    addEventListener("keydown", (event) => {
      if (pickOn && event.key === "Escape") {
        setPick(false);
        send("pick-cancelled");
      }
    }, true);
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
  // npm deps must win over tsconfig path aliases (e.g. "react/*" → types) so JSX runtime resolves.
  const imports = {
    ...pathAliasImports(tsconfigFile?.source || "{}"),
    ...dependencyMap(packageSource),
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

async function serveIndexHtml(sessionId) {
  const index = await readSource(sessionId, "index.html");
  if (!index) return null;
  const source = await transformHtml(sessionId, index.source);
  return new Response(source, { headers: responseHeaders("text/html; charset=utf-8") });
}

async function handlePreviewRequest(url, request) {
  const remainder = url.pathname.slice(PREVIEW_PREFIX.length);
  const slash = remainder.indexOf("/");
  const sessionId = slash === -1 ? remainder : remainder.slice(0, slash);
  const requestedPath = cleanPath(slash === -1 ? "index.html" : remainder.slice(slash + 1)) || "index.html";

  try {
    const file = await readSource(sessionId, requestedPath);

    if (!file) {
      // SPA fallback: /__preview__/{session}/gomoku → index.html (BrowserRouter refresh)
      if (isSpaRoutePath(requestedPath) && isDocumentRequest(request)) {
        const spa = await serveIndexHtml(sessionId);
        if (spa) return spa;
      }
      return new Response(`Virtual file not found: ${requestedPath}`, {
        status: 404,
        headers: responseHeaders("text/plain; charset=utf-8"),
      });
    }

    let source = file.source;
    let type = mimeType(file.path);

    if (file.path.endsWith(".html")) source = await transformHtml(sessionId, source);
    if (isScriptModule(file.path)) {
      const packageFile = await readSource(sessionId, "package.json");
      const reactVersion = packageReactVersion(packageFile?.source || "{}");
      source = await transpileModule(source, file.path, reactVersion);
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
