/**
 * Host-bundled lib.d.ts + React DefinitelyTyped for browser typecheck.
 * Avoids TypeScript playground CDN (404 on obsolete libs) and jsDelivr.
 */

function mapFromGlob(modules: Record<string, string>, kind: "lib" | "node_modules"): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, source] of Object.entries(modules)) {
    if (typeof source !== "string") continue;
    const normalized = key.replaceAll("\\", "/");
    if (kind === "lib") {
      const name = normalized.slice(normalized.lastIndexOf("/") + 1);
      if (name.startsWith("lib.") && name.endsWith(".d.ts")) out.set(`/${name}`, source);
      continue;
    }
    const index = normalized.indexOf("node_modules/");
    if (index >= 0) out.set(`/${normalized.slice(index)}`, source);
  }
  return out;
}

const bundledLibs = import.meta.glob("../../node_modules/typescript-browser/lib/lib.*.d.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const bundledReact = import.meta.glob(
  [
    "../../node_modules/@types/react/*.{d.ts,json}",
    "../../node_modules/@types/react/ts5.0/*.{d.ts,json}",
    "../../node_modules/@types/react-dom/*.{d.ts,json}",
    "../../node_modules/@types/react-dom/client.d.ts",
    "../../node_modules/@types/react-dom/server.d.ts",
    "../../node_modules/@types/react-dom/test-utils/index.d.ts",
    "../../node_modules/csstype/index.d.ts",
    "../../node_modules/csstype/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

let libCache: Map<string, string> | null = null;
let reactCache: Map<string, string> | null = null;

export function getBundledTsLibs(): Map<string, string> {
  libCache ??= mapFromGlob(bundledLibs, "lib");
  return libCache;
}

export function getBundledReactTypes(): Map<string, string> {
  reactCache ??= mapFromGlob(bundledReact, "node_modules");
  return reactCache;
}
