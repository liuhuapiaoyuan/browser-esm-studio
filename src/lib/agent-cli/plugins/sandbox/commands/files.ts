import { z } from "zod";
import { defineCommand } from "../../../define-command";
import { formatGrepResult, formatReadWindow, mapSandboxError } from "../shared";

export const sandboxListFiles = defineCommand({
  metadata: {
    name: "sandbox.listFiles",
    version: "1.0.0",
    title: "列出虚拟文件",
    summary: "列出虚拟项目全部文件路径（已排序）",
    tags: ["sandbox", "files", "read", "list"],
  },
  agent: {
    purpose: "快速了解项目有哪些文件",
    useWhen: ["开始探索项目结构", "不确定路径时"],
    avoidWhen: ["已知路径直接读写"],
    examples: [{ userRequest: "项目里有哪些文件", input: {} }],
  },
  inputSchema: z.object({
    include: z.literal("all").optional().describe("Optional; omit or pass all"),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(_input, ctx) {
    return { files: ctx.sandbox.list() };
  },
});

export const sandboxReadFile = defineCommand({
  metadata: {
    name: "sandbox.readFile",
    version: "1.0.0",
    title: "读取虚拟文件",
    summary: "读取文件全文，或按 around/startLine 窗口读取（窗口内容带 LINE| 前缀）",
    tags: ["sandbox", "files", "read"],
  },
  agent: {
    purpose: "读取源码内容；grep 命中后用 around 扩展上下文",
    useWhen: ["需要看文件内容", "grep 命中后扩展"],
    avoidWhen: ["只想搜关键词（用 sandbox.grep）"],
    instructions: [
      "默认只传 path（全文）。窗口优先用 around（number），不要默认塞 startLine",
      "around / radius / startLine / endLine 必须是 JSON number，禁止字符串 \"40\"、null、空串",
      "窗口读取返回 LINE| 前缀 — 写入 replaceInFile 前必须去掉前缀",
      "优先窗口读取，不要一上来读整个大文件",
    ],
    examples: [
      {
        userRequest: "打开 src/App.tsx",
        input: { path: "src/App.tsx" },
      },
      {
        userRequest: "看看 App.tsx 第 40 行附近",
        input: { path: "src/App.tsx", around: 40, radius: 40 },
      },
      {
        userRequest: "读 App.tsx 第 10–80 行",
        input: { path: "src/App.tsx", startLine: 10, endLine: 80 },
      },
    ],
  },
  inputSchema: z.object({
    path: z.string().describe("Relative path, e.g. src/App.tsx"),
    around: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("JSON number (not string). 1-based center line from grep; expands with radius"),
    radius: z
      .number()
      .int()
      .min(0)
      .max(80)
      .optional()
      .describe("JSON number. Lines before/after `around` (default 40)"),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("JSON number (not string). 1-based inclusive start; prefer `around` when possible"),
    endLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("JSON number (not string). 1-based inclusive end"),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  recovery: {
    maxAutoRetries: 1,
    errors: {
      RESOURCE_NOT_FOUND: {
        description: "文件不存在",
        retryable: true,
        suggestions: ["调用 sandbox.listFiles 或 sandbox.grep 确认路径"],
      },
    },
  },
  async execute(input, ctx) {
    try {
      const raw = ctx.sandbox.read(input.path);
      const window = formatReadWindow(raw, input);
      return { path: input.path, ...window };
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxGrep = defineCommand({
  metadata: {
    name: "sandbox.grep",
    version: "1.0.0",
    title: "搜索文件内容",
    summary: "在虚拟项目中搜索（literal / regex / fuzzy / word）；progressive explore 第一步",
    tags: ["sandbox", "search", "grep", "read"],
  },
  agent: {
    purpose: "按关键词/符号定位文件与行号，再 readFile 扩展",
    useWhen: ["找定义、引用、样式类名", "不确定改哪"],
    avoidWhen: ["已知精确路径只需读文件"],
    instructions: [
      "命中后用 sandbox.readFile(path, around=line) 扩展，不要依赖大段 grep context",
      "不要同时组合 regex/word 与 fuzzy",
    ],
    examples: [
      {
        userRequest: "Button 组件在哪",
        input: { query: "Button", word: true, outputMode: "files" },
      },
    ],
  },
  inputSchema: z.object({
    query: z.string().describe("Search text, RegExp source, or fuzzy query"),
    regex: z.boolean().optional().describe("Treat query as RegExp"),
    fuzzy: z
      .boolean()
      .optional()
      .describe("Fuzzy subsequence search; spaces split required tokens"),
    word: z
      .boolean()
      .optional()
      .describe("Match whole identifiers only (\\b); good for symbol names"),
    caseSensitive: z
      .boolean()
      .optional()
      .describe("Default true for literal/regex; default false for fuzzy"),
    paths: z.array(z.string()).optional().describe("Limit to these relative paths"),
    glob: z.string().optional().describe('Path glob, e.g. "src/**/*.tsx"'),
    context: z
      .number()
      .int()
      .min(0)
      .max(10)
      .optional()
      .describe("Lines of before/after context per hit (default 2 for content)"),
    outputMode: z
      .enum(["files", "content"])
      .optional()
      .describe("files = path+count only; content = hits with context (default)"),
    maxResults: z.number().int().positive().max(200).optional(),
  }),
  safety: { risk: "read", sideEffect: false, idempotent: true },
  async execute(input, ctx) {
    try {
      const outputMode = input.outputMode ?? "content";
      const maxResults = input.maxResults ?? 80;
      const context = input.context ?? (outputMode === "content" ? 2 : 0);
      const matches = ctx.sandbox.grep(input.query, {
        regex: input.regex,
        fuzzy: input.fuzzy,
        word: input.word,
        caseSensitive: input.caseSensitive,
        paths: input.paths,
        glob: input.glob,
        context: outputMode === "files" ? 0 : context,
        maxResults: outputMode === "files" ? maxResults : Math.min(200, maxResults * 2),
      });
      return formatGrepResult(matches, outputMode, maxResults);
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxWriteFile = defineCommand({
  metadata: {
    name: "sandbox.writeFile",
    version: "1.0.0",
    title: "写入文件",
    summary: "创建或覆盖虚拟文件；小改动优先 replaceInFile",
    tags: ["sandbox", "files", "write"],
  },
  agent: {
    purpose: "新建或整文件重写",
    useWhen: ["新文件", "有意全文重写"],
    avoidWhen: ["局部小改（用 sandbox.replaceInFile）"],
    examples: [
      {
        userRequest: "新建一个 utils 文件",
        input: { path: "src/lib/format.ts", content: "export function format() {}\n" },
      },
    ],
  },
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: true, confirmation: "on-write" },
  async execute(input, ctx) {
    try {
      return ctx.sandbox.write(input.path, input.content);
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxAddFile = defineCommand({
  metadata: {
    name: "sandbox.addFile",
    version: "1.0.0",
    title: "新增文件",
    summary: "仅当文件不存在时创建；已存在则失败",
    tags: ["sandbox", "files", "write"],
  },
  agent: {
    purpose: "安全新建文件，避免误覆盖",
    useWhen: ["确定是新路径"],
    avoidWhen: ["可能已存在需覆盖（用 writeFile）"],
    examples: [
      {
        userRequest: "添加空的 components 文件",
        input: { path: "src/components/Card.tsx", content: "" },
      },
    ],
  },
  inputSchema: z.object({
    path: z.string(),
    content: z.string().optional(),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input, ctx) {
    try {
      return ctx.sandbox.add(input.path, input.content ?? "");
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxRemoveFile = defineCommand({
  metadata: {
    name: "sandbox.removeFile",
    version: "1.0.0",
    title: "删除文件",
    summary: "删除虚拟文件；index.html 与 package.json 受保护",
    tags: ["sandbox", "files", "destructive"],
  },
  agent: {
    purpose: "删除不再需要的文件",
    useWhen: ["清理无用文件"],
    avoidWhen: ["删除 index.html / package.json（受保护）"],
    examples: [{ userRequest: "删掉临时文件", input: { path: "src/tmp.ts" } }],
  },
  inputSchema: z.object({ path: z.string() }),
  safety: {
    risk: "destructive",
    sideEffect: true,
    idempotent: true,
    confirmation: "always",
  },
  async execute(input, ctx) {
    try {
      return ctx.sandbox.remove(input.path);
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxReplaceInFile = defineCommand({
  metadata: {
    name: "sandbox.replaceInFile",
    version: "1.0.0",
    title: "替换文件片段",
    summary: "在单文件中做精确字符串/正则替换；局部编辑首选",
    tags: ["sandbox", "files", "write", "edit"],
  },
  agent: {
    purpose: "外科手术式改文件",
    useWhen: ["局部修改", "改几行或一个符号"],
    avoidWhen: ["大段重写（用 writeFile）"],
    instructions: [
      "oldString/newString 不要带 readFile 窗口的 LINE| 前缀",
      "多处相同替换设 replaceAll=true",
    ],
    examples: [
      {
        userRequest: "把标题改成 Hello",
        input: {
          path: "src/App.tsx",
          oldString: "<h1>Old</h1>",
          newString: "<h1>Hello</h1>",
        },
      },
    ],
  },
  inputSchema: z.object({
    path: z.string().describe("Relative file path, e.g. src/App.tsx"),
    oldString: z.string().describe("Exact text to find (no LINE| prefixes)"),
    newString: z.string().describe("Replacement text"),
    regex: z.boolean().optional(),
    replaceAll: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: true, confirmation: "on-write" },
  recovery: {
    maxAutoRetries: 1,
    errors: {
      NO_MATCH: {
        description: "未找到 oldString",
        retryable: true,
        suggestions: [
          "sandbox.readFile 确认当前内容",
          "去掉 LINE| 前缀后重试",
        ],
      },
    },
  },
  async execute(input, ctx) {
    try {
      return ctx.sandbox.replace(input.path, input.oldString, input.newString, {
        regex: input.regex,
        replaceAll: input.replaceAll,
        caseSensitive: input.caseSensitive,
      });
    } catch (e) {
      mapSandboxError(e);
    }
  },
});

export const sandboxApplyOperations = defineCommand({
  metadata: {
    name: "sandbox.applyOperations",
    version: "1.0.0",
    title: "原子批量改文件",
    summary: "一次应用多条 write/add/remove/replace；失败整批回滚",
    tags: ["sandbox", "files", "write", "batch"],
  },
  agent: {
    purpose: "多文件必须同时成功时的原子提交",
    useWhen: ["跨文件一致性变更"],
    avoidWhen: ["单文件小改（用 replaceInFile）"],
    instructions: [
      "单文件优先用 sandbox.replaceInFile，不要滥用 applyOperations",
      "operations[].type 只能是 write | add | remove | replace（不要写 writeFile/replaceInFile）",
      "replace 项必须带 path + oldString + newString",
    ],
    examples: [
      {
        userRequest: "同时新建组件并改导出",
        input: {
          operations: [
            {
              type: "add",
              path: "src/components/X.tsx",
              content: "export function X(){return null}",
            },
            {
              type: "replace",
              path: "src/App.tsx",
              oldString: "export default",
              newString: 'import { X } from "@/components/X.tsx";\nexport default',
            },
          ],
        },
      },
    ],
  },
  inputSchema: z.object({
    operations: z
      .array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("write"),
            path: z.string(),
            content: z.string(),
          }),
          z.object({
            type: z.literal("add"),
            path: z.string(),
            content: z.string().optional(),
          }),
          z.object({
            type: z.literal("remove"),
            path: z.string(),
          }),
          z.object({
            type: z.literal("replace"),
            path: z.string(),
            oldString: z.string(),
            newString: z.string(),
            regex: z.boolean().optional(),
            replaceAll: z.boolean().optional(),
            caseSensitive: z.boolean().optional(),
          }),
        ]),
      )
      .describe("Batch ops; type must be write|add|remove|replace"),
  }),
  safety: { risk: "write", sideEffect: true, idempotent: false, confirmation: "on-write" },
  async execute(input, ctx) {
    try {
      return ctx.sandbox.apply(input.operations);
    } catch (e) {
      mapSandboxError(e);
    }
  },
});
