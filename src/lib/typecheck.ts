import type { FileMap } from "../types";

export type TypecheckDiagnostic = {
  path: string;
  line: number;
  column: number;
  message: string;
  code: number;
  category: "error" | "warning" | "suggestion" | "message";
};

export type TypecheckResult = {
  ok: boolean;
  diagnostics: TypecheckDiagnostic[];
  checkedFiles: number;
};

type TsModule = typeof import("typescript-browser/lib/typescript.js");

const CATEGORY = ["warning", "error", "suggestion", "message"] as const;

/**
 * Style / import-elision diagnostics. Studio typecheck treats these as warnings
 * so agents don't thrash on `import` vs `import type` (TS1484 etc.).
 */
const SOFT_DIAGNOSTIC_CODES = new Set([
  1484, // type-only import required when verbatimModuleSyntax is enabled
  1205, // re-exporting a type requires `export type` under isolatedModules
]);

function isGeneratedPath(path: string): boolean {
  return /(^|\/)ddb\/generated\//.test(path.replaceAll("\\", "/"));
}

/** Cache lib maps keyed by TS version + target. */
const libMapCache = new Map<string, Map<string, string>>();

function normalizeVirtualPath(path: string): string {
  return `/${path.replace(/^\/+/, "").replaceAll("\\", "/")}`;
}

function parsePackageDeps(packageJson: string | undefined): string[] {
  if (!packageJson) return [];
  try {
    const manifest = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    // Only runtime deps matter for app typecheck; skip build tooling.
    return Object.keys(manifest.dependencies || {});
  } catch {
    return [];
  }
}

function compilerOptionsFromTsConfig(ts: TsModule, source: string | undefined) {
  const defaults: import("typescript-browser/lib/typescript.js").CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    isolatedModules: true,
    allowImportingTsExtensions: true,
    esModuleInterop: true,
    allowJs: false,
    forceConsistentCasingInFileNames: true,
    verbatimModuleSyntax: false,
  };

  if (!source?.trim()) return defaults;

  const { config, error } = ts.parseConfigFileTextToJson("tsconfig.json", source);
  if (error || !config || typeof config !== "object") return defaults;

  const compilerOptions =
    "compilerOptions" in config && config.compilerOptions && typeof config.compilerOptions === "object"
      ? config.compilerOptions
      : {};
  const converted = ts.convertCompilerOptionsFromJson(compilerOptions, "/");
  return {
    ...defaults,
    ...converted.options,
    lib: converted.options.lib?.length ? converted.options.lib : defaults.lib,
    noEmit: true,
    skipLibCheck: true,
    // Studio Preview uses Sucrase, not tsc emit — don't fail on import-elision style.
    verbatimModuleSyntax: false,
  };
}

async function loadLibsFromNodeModules(): Promise<Map<string, string> | null> {
  if (typeof window !== "undefined") return null;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const libDir = path.join(path.dirname(require.resolve("typescript-browser/package.json")), "lib");
    const map = new Map<string, string>();
    for (const name of await fs.readdir(libDir)) {
      if (!name.startsWith("lib.") || !name.endsWith(".d.ts")) continue;
      map.set(`/${name}`, await fs.readFile(path.join(libDir, name), "utf8"));
    }
    return map.has("/lib.dom.d.ts") && map.has("/lib.es2022.d.ts") ? map : null;
  } catch {
    return null;
  }
}

async function loadPackageTypesFromNodeModules(packages: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (typeof window !== "undefined") return out;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const pkg of packages) {
      const root = path.join(process.cwd(), "node_modules", ...pkg.split("/"));
      const stat = await fs.stat(root).catch(() => null);
      if (!stat?.isDirectory()) continue;
      async function walk(dir: string, prefix: string) {
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
          const rel = `${prefix}/${entry.name}`;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === "node_modules") continue;
            await walk(full, rel);
          } else if (entry.name.endsWith(".d.ts") || entry.name === "package.json") {
            out.set(`/node_modules/${pkg}${rel}`, await fs.readFile(full, "utf8"));
          }
        }
      }
      await walk(root, "");
    }
  } catch {
    // ignore
  }
  return out;
}

async function acquireDependencyTypes(deps: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  if (typeof window !== "undefined") {
    const { getBundledReactTypes, getBundledDynamicDbClientTypes } = await import(
      "./typecheck-bundled-types"
    );
    for (const [path, source] of getBundledReactTypes()) out.set(path, source);
    for (const [path, source] of getBundledDynamicDbClientTypes()) out.set(path, source);
  } else {
    for (const [path, source] of await loadPackageTypesFromNodeModules([
      "@types/react",
      "@types/react-dom",
      "csstype",
      "@qzsy/dynamic-db-client",
    ])) {
      out.set(path, source);
    }
  }

  // Richer stubs for shadcn-style deps so `import type { … }` works under skipLibCheck.
  const knownStubs: Record<string, string> = {
    clsx: `export type ClassValue =
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | ClassDictionary
  | ClassArray;
export interface ClassDictionary {
  [id: string]: any;
}
export interface ClassArray extends Array<ClassValue> {}
export declare function clsx(...inputs: ClassValue[]): string;
export default clsx;
`,
    "tailwind-merge": `export declare function twMerge(
  ...classLists: Array<string | undefined | null | false | 0>
): string;
`,
    "class-variance-authority": `import type { ClassValue } from "clsx";

export type VariantProps<Component extends (...args: any) => any> = Omit<
  NonNullable<Parameters<Component>[0]>,
  "class" | "className"
>;

export declare function cva(
  base?: ClassValue,
  config?: {
    variants?: Record<string, Record<string, ClassValue>>;
    defaultVariants?: Record<string, string | number | boolean | null>;
    compoundVariants?: Array<Record<string, any>>;
  },
): (props?: Record<string, any>) => string;
`,
  };

  // Ambient stubs for other runtime deps (lucide-react, xlsx, …). No CDN.
  const neverStub = new Set(["react", "react-dom", "csstype", "@qzsy/dynamic-db-client"]);
  for (const dep of deps) {
    if (neverStub.has(dep)) continue;
    if (dep.startsWith("@types/")) continue;
    const hasTypes = [...out.keys()].some(
      (path) => path.startsWith(`/node_modules/${dep}/`) || path.startsWith(`/node_modules/@types/${dep}/`),
    );
    if (hasTypes) continue;

    out.set(`/node_modules/${dep}/index.d.ts`, knownStubs[dep] ?? `declare module ${JSON.stringify(dep)};\n`);
    out.set(`/node_modules/${dep}/package.json`, JSON.stringify({ name: dep, types: "index.d.ts" }));
  }

  return out;
}

function rootNamesFromFiles(files: FileMap): string[] {
  return Object.keys(files)
    .filter(
      (path) =>
        /\.(tsx|ts)$/i.test(path) &&
        !path.endsWith(".d.ts") &&
        !/(^|\/)vite\.config\.[cm]?[tj]s$/i.test(path),
    )
    .map(normalizeVirtualPath);
}

function resolveTsModule(mod: { default?: TsModule } & TsModule): TsModule {
  return (mod.default ?? mod) as TsModule;
}

async function loadLibMap(): Promise<Map<string, string>> {
  const fromNode = await loadLibsFromNodeModules();
  if (fromNode) return fromNode;

  const { getBundledTsLibs } = await import("./typecheck-bundled-types");
  const bundled = getBundledTsLibs();
  if (!bundled.has("/lib.dom.d.ts") || !bundled.has("/lib.es2022.d.ts")) {
    throw new Error("Bundled TypeScript libs missing DOM/ES2022 definitions.");
  }
  return bundled;
}

/**
 * Typecheck a virtual FileMap in the browser (tsc --noEmit equivalent).
 * Uses TypeScript 5.x Compiler API + @typescript/vfs; host build stays on TS 7.
 */
export async function typecheckProject(files: FileMap): Promise<TypecheckResult> {
  const [tsMod, tsvfs] = await Promise.all([
    import("typescript-browser/lib/typescript.js"),
    import("@typescript/vfs"),
  ]);
  const ts = resolveTsModule(tsMod);

  const options = compilerOptionsFromTsConfig(ts, files["tsconfig.json"]);
  const cacheKey = `${ts.version}:${options.target}:${(options.lib || []).join(",")}`;

  // @typescript/vfs is typed against host `typescript` (TS7); runtime uses TS5 API.
  const tsForVfs = ts as never;

  let fsMap = libMapCache.get(cacheKey);
  if (!fsMap) {
    fsMap = await loadLibMap();
    libMapCache.set(cacheKey, fsMap);
  }

  const map = new Map(fsMap);

  for (const [path, source] of Object.entries(files)) {
    map.set(normalizeVirtualPath(path), source);
  }

  const depTypes = await acquireDependencyTypes(parsePackageDeps(files["package.json"]));
  for (const [path, source] of depTypes) map.set(path, source);

  // VFS + sandbox `baseUrl: "."` breaks node_modules resolution; pin absolute paths.
  options.baseUrl = "/";
  const pathMap: Record<string, string[]> = {
    "@/*": ["/src/*"],
  };
  if (map.has("/node_modules/@types/react/jsx-runtime.d.ts")) {
    Object.assign(pathMap, {
      react: ["/node_modules/@types/react/index.d.ts"],
      "react/*": ["/node_modules/@types/react/*"],
      "react/jsx-runtime": ["/node_modules/@types/react/jsx-runtime.d.ts"],
      "react/jsx-dev-runtime": ["/node_modules/@types/react/jsx-dev-runtime.d.ts"],
      "react-dom": ["/node_modules/@types/react-dom/index.d.ts"],
      "react-dom/*": ["/node_modules/@types/react-dom/*"],
      "react-dom/client": ["/node_modules/@types/react-dom/client.d.ts"],
    });
  }
  if (map.has("/node_modules/@qzsy/dynamic-db-client/dist/index.d.ts")) {
    // Avoid resolving to a stale `/node_modules/@qzsy/dynamic-db-client/index` stub.
    map.delete("/node_modules/@qzsy/dynamic-db-client/index.d.ts");
    pathMap["@qzsy/dynamic-db-client"] = ["/node_modules/@qzsy/dynamic-db-client/dist/index.d.ts"];
  }
  options.paths = pathMap;

  const rootNames = rootNamesFromFiles(files);
  if (rootNames.length === 0) {
    return { ok: true, diagnostics: [], checkedFiles: 0 };
  }

  const system = tsvfs.createSystem(map);
  const { compilerHost } = tsvfs.createVirtualCompilerHost(system, options, tsForVfs);
  const readFile = compilerHost.readFile.bind(compilerHost);
  const getSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  compilerHost.getSourceFile = (
    fileName: string,
    languageVersion: Parameters<typeof getSourceFile>[1],
    onError?: Parameters<typeof getSourceFile>[2],
    shouldCreateNewSourceFile?: Parameters<typeof getSourceFile>[3],
  ) => {
    if (readFile(fileName) == null) return undefined;
    return getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  const program = ts.createProgram({
    rootNames,
    options,
    host: compilerHost,
  });

  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
    ...program.getConfigFileParsingDiagnostics(),
  ];

  const formatted: TypecheckDiagnostic[] = diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      let path = "";
      let line = 1;
      let column = 1;
      if (diagnostic.file && diagnostic.start != null) {
        path = diagnostic.file.fileName.replace(/^\//, "");
        const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        line = pos.line + 1;
        column = pos.character + 1;
      }
      const rawCategory = CATEGORY[diagnostic.category] || "error";
      const category =
        rawCategory === "error" && SOFT_DIAGNOSTIC_CODES.has(diagnostic.code) ? "warning" : rawCategory;
      return {
        path,
        line,
        column,
        message,
        code: diagnostic.code,
        category,
      };
    })
    // Host-generated SDK — trust codegen; don't surface or auto-fix its diagnostics.
    .filter((item) => !isGeneratedPath(item.path));

  const errors = formatted.filter((item) => item.category === "error");
  return {
    ok: errors.length === 0,
    diagnostics: formatted,
    checkedFiles: rootNames.length,
  };
}

export function formatTypecheckDiagnostics(result: TypecheckResult, limit = 30): string[] {
  return result.diagnostics.slice(0, limit).map((item) => {
    const where = item.path ? `${item.path}:${item.line}:${item.column}` : "tsconfig";
    return `${where} TS${item.code}: ${item.message}`;
  });
}
