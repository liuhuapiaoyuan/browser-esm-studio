import type { DefinedCommand, SearchHit } from "./protocol";

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,/|_.-:;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreCommand(cmd: DefinedCommand, tokens: string[], rawQuery: string): number {
  if (tokens.length === 0 && !rawQuery.trim()) return 0;

  const name = cmd.metadata.name.toLowerCase();
  const title = cmd.metadata.title.toLowerCase();
  const summary = cmd.metadata.summary.toLowerCase();
  const purpose = cmd.agent.purpose.toLowerCase();
  const tags = (cmd.metadata.tags ?? []).map((t) => t.toLowerCase());
  const useWhen = cmd.agent.useWhen.join(" ").toLowerCase();
  const aliases = (cmd.metadata.aliases ?? []).map((a) => a.toLowerCase());
  const q = rawQuery.toLowerCase().trim();

  let score = 0;

  if (q && (name === q || aliases.includes(q))) score += 100;
  if (q && (name.includes(q) || aliases.some((a) => a.includes(q)))) score += 40;

  for (const token of tokens) {
    if (name === token || name.endsWith(`.${token}`) || name.includes(`.${token}`)) score += 28;
    else if (name.includes(token)) score += 14;

    if (aliases.some((a) => a === token || a.includes(token))) score += 18;
    if (tags.includes(token)) score += 22;
    else if (tags.some((t) => t.includes(token))) score += 10;

    if (title.includes(token)) score += 12;
    if (summary.includes(token)) score += 10;
    if (purpose.includes(token)) score += 8;
    if (useWhen.includes(token)) score += 6;
  }

  return score;
}

export function createRegistry() {
  const byName = new Map<string, DefinedCommand>();

  function register(command: DefinedCommand) {
    const name = command.metadata.name.trim();
    if (!name) throw new Error("Command name is required");
    if (byName.has(name)) {
      throw new Error(`Duplicate command: ${name}`);
    }
    byName.set(name, command);
    for (const alias of command.metadata.aliases ?? []) {
      const key = alias.trim();
      if (!key) continue;
      if (byName.has(key)) {
        throw new Error(`Duplicate command alias: ${key}`);
      }
      byName.set(key, command);
    }
  }

  function registerAll(commands: DefinedCommand[]) {
    for (const cmd of commands) register(cmd);
  }

  function get(name: string): DefinedCommand | undefined {
    return byName.get(name.trim());
  }

  function list(): DefinedCommand[] {
    const seen = new Set<string>();
    const out: DefinedCommand[] = [];
    for (const cmd of byName.values()) {
      if (seen.has(cmd.metadata.name)) continue;
      seen.add(cmd.metadata.name);
      out.push(cmd);
    }
    return out.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }

  function search(query: string, limit = 5): SearchHit[] {
    const tokens = tokenize(query);
    const hits: SearchHit[] = [];
    for (const cmd of list()) {
      const raw = scoreCommand(cmd, tokens, query);
      if (raw <= 0) continue;
      hits.push({
        name: cmd.metadata.name,
        score: Math.min(1, raw / 100),
        summary: cmd.metadata.summary,
        title: cmd.metadata.title,
        tags: cmd.metadata.tags ?? [],
        risk: cmd.safety.risk,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return hits.slice(0, Math.max(1, Math.min(50, limit)));
  }

  return { register, registerAll, get, list, search };
}

export type CommandRegistry = ReturnType<typeof createRegistry>;
