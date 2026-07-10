import assert from "node:assert/strict";
import * as Sucrase from "sucrase";

const handlers = new Map();
const store = new Map();

globalThis.Sucrase = Sucrase;
globalThis.self = {
  location: { origin: "http://localhost:5173" },
  clients: { claim: async () => undefined },
  skipWaiting: () => undefined,
  addEventListener: (type, handler) => handlers.set(type, handler),
};

globalThis.caches = {
  open: async () => ({
    keys: async () => [...store.keys()].map((url) => new Request(url)),
    delete: async (request) => store.delete(typeof request === "string" ? request : request.url),
    put: async (request, response) => {
      store.set(typeof request === "string" ? request : request.url, response.clone());
    },
    match: async (request) => {
      const response = store.get(typeof request === "string" ? request : request.url);
      return response?.clone();
    },
  }),
};

await import(`../public/preview-sw.js?smoke=${Date.now()}`);

const messageHandler = handlers.get("message");
const fetchHandler = handlers.get("fetch");
assert.ok(messageHandler, "message handler should be registered");
assert.ok(fetchHandler, "fetch handler should be registered");

const files = {
  "index.html": "<html><head></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.tsx\"></script></body></html>",
  "package.json": JSON.stringify({
    dependencies: { react: "^19.1.0", "react-dom": "^19.1.0", "lucide-react": "^0.468.0" },
    devDependencies: { typescript: "~5.7.3", vite: "latest" },
  }),
  "src/main.tsx": "import { createRoot } from 'react-dom/client';\nimport { App } from './App.tsx';\nimport './styles.css';\ncreateRoot(document.getElementById('root')!).render(<App />);",
  "src/App.tsx": "export function App() { const label: string = 'hello'; return <h1>{label}</h1>; }",
  "src/styles.css": "body { color: rebeccapurple; }",
};

await new Promise((resolve, reject) => {
  messageHandler({
    data: { type: "SYNC_PREVIEW_PROJECT", sessionId: "test", files },
    ports: [{ postMessage: (message) => message.ok ? resolve() : reject(new Error(message.error)) }],
    waitUntil: (promise) => promise.catch(reject),
  });
});

async function request(path) {
  let responsePromise;
  fetchHandler({
    request: new Request(`http://localhost:5173${path}`),
    respondWith: (promise) => { responsePromise = promise; },
  });
  assert.ok(responsePromise, `request should be intercepted: ${path}`);
  return responsePromise;
}

const html = await request("/__preview__/test/index.html");
const htmlSource = await html.text();
assert.equal(html.status, 200);
assert.match(htmlSource, /type="importmap"/);
assert.match(htmlSource, /https:\/\/esm\.sh\/react@19\.1\.0\?dev&target=es2022/);
assert.match(htmlSource, /https:\/\/esm\.sh\/react-dom@19\.1\.0\?dev&target=es2022/);
assert.match(htmlSource, /lucide-react@0\.468\.0\?dev&target=es2022&deps=react@19\.1\.0,react-dom@19\.1\.0/);
assert.doesNotMatch(htmlSource, /typescript@/);
assert.match(htmlSource, /browser-esm-preview/);

const typescript = await request("/__preview__/test/src/App.tsx");
assert.equal(typescript.status, 200);
assert.equal(typescript.headers.get("content-type"), "text/javascript; charset=utf-8");
const tsSource = await typescript.text();
assert.match(tsSource, /jsx-runtime|createElement|react/);
assert.doesNotMatch(tsSource, /:\s*string/);

const entry = await request("/__preview__/test/src/main.tsx");
assert.equal(entry.status, 200);
assert.match(await entry.text(), /styles\.css\?__preview_css__/);

const cssModule = await request("/__preview__/test/src/styles.css?__preview_css__");
assert.equal(cssModule.headers.get("content-type"), "text/javascript; charset=utf-8");
assert.match(await cssModule.text(), /document\.createElement\("style"\)/);

const extensionless = await request("/__preview__/test/src/App");
assert.equal(extensionless.status, 200);

const missing = await request("/__preview__/test/does-not-exist.tsx");
assert.equal(missing.status, 404);

// --- Path aliases + Tailwind browser runtime ---
const shadcnFiles = {
  "index.html": "<html><head></head><body><div id=\"root\"></div><script type=\"module\" src=\"./src/main.tsx\"></script></body></html>",
  "package.json": JSON.stringify({
    dependencies: { react: "^19.1.0", "react-dom": "^19.1.0", clsx: "^2.1.1", "tailwind-merge": "^3.0.2" },
    devDependencies: { tailwindcss: "^4.0.14", "@tailwindcss/vite": "^4.0.14", typescript: "~5.7.3", vite: "latest" },
  }),
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      baseUrl: ".",
      paths: { "@/*": ["./src/*"] },
    },
  }),
  "src/main.tsx": "import { App } from '@/App.tsx';\nimport '@/index.css';\nexport { App };",
  "src/App.tsx": "export function App() { return <h1 className=\"text-3xl font-bold\">hi</h1>; }",
  "src/index.css": "@import \"tailwindcss\";\n\n@theme {\n  --color-brand: #22c55e;\n}\n\nbody { margin: 0; }\n",
};

await new Promise((resolve, reject) => {
  messageHandler({
    data: { type: "SYNC_PREVIEW_PROJECT", sessionId: "shadcn", files: shadcnFiles },
    ports: [{ postMessage: (message) => (message.ok ? resolve() : reject(new Error(message.error))) }],
    waitUntil: (promise) => promise.catch(reject),
  });
});

const shadcnHtml = await request("/__preview__/shadcn/index.html");
const shadcnHtmlSource = await shadcnHtml.text();
assert.equal(shadcnHtml.status, 200);
assert.match(shadcnHtmlSource, /"@\/"\s*:\s*"\.\/src\/"/);
assert.match(shadcnHtmlSource, /@tailwindcss\/browser@4/);
assert.doesNotMatch(shadcnHtmlSource, /tailwindcss@4/);

const twCss = await request("/__preview__/shadcn/src/index.css?__preview_css__");
assert.equal(twCss.status, 200);
const twCssSource = await twCss.text();
assert.match(twCssSource, /text\/tailwindcss/);
assert.doesNotMatch(twCssSource, /@import\s+["']tailwindcss["']/);
assert.match(twCssSource, /@theme/);

await new Promise((resolve, reject) => {
  messageHandler({
    data: {
      type: "SYNC_PREVIEW_PROJECT",
      sessionId: "test",
      files: {
        ...files,
        "src/broken.ts": "const x = <Oops;",
      },
    },
    ports: [{ postMessage: (message) => (message.ok ? resolve() : reject(new Error(message.error))) }],
    waitUntil: (promise) => promise.catch(reject),
  });
});

const broken = await request("/__preview__/test/src/broken.ts");
assert.equal(broken.status, 200);
assert.equal(broken.headers.get("content-type"), "text/javascript; charset=utf-8");
const brokenSource = await broken.text();
assert.match(brokenSource, /^throw new Error\(/);
assert.match(brokenSource, /转译失败|Unexpected token/);

console.log("Preview runtime smoke test passed.");
