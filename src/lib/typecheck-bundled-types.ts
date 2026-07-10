/**
 * Host-bundled lib.d.ts + React DefinitelyTyped + dynamic-db-client for browser typecheck.
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

// Explicit ?raw imports — glob+package.json is flaky in the browser bundle.
import dynamicDbClientPkg from "../../node_modules/@qzsy/dynamic-db-client/package.json?raw";
import dynamicDbClientIndex from "../../node_modules/@qzsy/dynamic-db-client/dist/index.d.ts?raw";
import dynamicDbClientHttp from "../../node_modules/@qzsy/dynamic-db-client/dist/http.d.ts?raw";
import dynamicDbClientTypes from "../../node_modules/@qzsy/dynamic-db-client/dist/types.d.ts?raw";
import dynamicDbClientDelegate from "../../node_modules/@qzsy/dynamic-db-client/dist/delegate.d.ts?raw";
import dynamicDbClientErrors from "../../node_modules/@qzsy/dynamic-db-client/dist/errors.d.ts?raw";

let libCache: Map<string, string> | null = null;
let reactCache: Map<string, string> | null = null;
let dynamicDbClientCache: Map<string, string> | null = null;

export function getBundledTsLibs(): Map<string, string> {
  libCache ??= mapFromGlob(bundledLibs, "lib");
  return libCache;
}

export function getBundledReactTypes(): Map<string, string> {
  reactCache ??= mapFromGlob(bundledReact, "node_modules");
  return reactCache;
}

/** Real `@qzsy/dynamic-db-client` .d.ts (not a hand-written stub). */
export function getBundledDynamicDbClientTypes(): Map<string, string> {
  if (!dynamicDbClientCache) {
    dynamicDbClientCache = new Map([
      ["/node_modules/@qzsy/dynamic-db-client/package.json", dynamicDbClientPkg],
      ["/node_modules/@qzsy/dynamic-db-client/dist/index.d.ts", dynamicDbClientIndex],
      ["/node_modules/@qzsy/dynamic-db-client/dist/http.d.ts", dynamicDbClientHttp],
      ["/node_modules/@qzsy/dynamic-db-client/dist/types.d.ts", dynamicDbClientTypes],
      ["/node_modules/@qzsy/dynamic-db-client/dist/delegate.d.ts", dynamicDbClientDelegate],
      ["/node_modules/@qzsy/dynamic-db-client/dist/errors.d.ts", dynamicDbClientErrors],
    ]);
  }
  return dynamicDbClientCache;
}
