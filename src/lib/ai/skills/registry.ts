import { ddbPlugin } from "../../agent-cli/plugins/ddb";
import { imagePlugin } from "../../agent-cli/plugins/image";
import { sandboxPlugin } from "../../agent-cli/plugins/sandbox";
import type { AiSkill, ResolvedSkills, SkillId, SkillSummary } from "./types";
import dynamicDbSkill from "./dynamic-db/SKILL.md?raw";
import liteImageSkill from "./lite-image/SKILL.md?raw";
import sandboxSkill from "./sandbox/SKILL.md?raw";

export type { AiSkill, ResolvedSkills, SkillId, SkillSummary };

const SKILLS: AiSkill[] = [
  {
    id: "sandbox",
    title: "Sandbox",
    description: "读取、搜索、修改虚拟项目文件，并执行类型检查与 Preview 错误检查",
    body: sandboxSkill,
    plugins: [sandboxPlugin],
    requires: [],
    defaultEnabled: true,
  },
  {
    id: "dynamic-db",
    title: "Dynamic DB",
    description:
      "Dynamic DB：schema/seed 用 cli_execute ddb.*；业务 CRUD 用 getDb()；setupSchema → codegen → kindNames",
    body: dynamicDbSkill,
    plugins: [ddbPlugin],
    requires: ["sandbox"],
    defaultEnabled: true,
  },
  {
    id: "lite-image",
    title: "Lite Image",
    description:
      "文生图 / 图生图：cli_execute image.generate → sandbox 仅存 path→URL 映射（经 /lite-image-proxy）",
    body: liteImageSkill,
    plugins: [imagePlugin],
    requires: ["sandbox"],
    defaultEnabled: true,
  },
];

const SKILL_BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

function summarize(skill: AiSkill): SkillSummary {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    requires: [...skill.requires],
    defaultEnabled: skill.defaultEnabled,
  };
}

export function listSkills(): SkillSummary[] {
  return SKILLS.map(summarize);
}

export function defaultSkillIds(): SkillId[] {
  return SKILLS.filter((skill) => skill.defaultEnabled).map((skill) => skill.id);
}

export function resolveSkills(requestedIds: readonly SkillId[]): ResolvedSkills {
  const normalizedRequested: SkillId[] = [];
  const requestedSet = new Set<SkillId>();

  for (const rawId of requestedIds) {
    const id = rawId.trim().toLowerCase();
    if (!id || requestedSet.has(id)) continue;
    if (!SKILL_BY_ID.has(id)) {
      throw new Error(`未知 skill: ${rawId}`);
    }
    requestedSet.add(id);
    normalizedRequested.push(id);
  }

  const activeSet = new Set<SkillId>();
  const visiting = new Set<SkillId>();
  const requiredBy = new Map<SkillId, Set<SkillId>>();

  function activate(id: SkillId) {
    if (activeSet.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Skill 依赖存在循环: ${[...visiting, id].join(" -> ")}`);
    }

    const skill = SKILL_BY_ID.get(id);
    if (!skill) {
      throw new Error(`Skill 依赖不存在: ${id}`);
    }

    visiting.add(id);
    for (const dependencyId of skill.requires) {
      const dependents = requiredBy.get(dependencyId) ?? new Set<SkillId>();
      dependents.add(id);
      requiredBy.set(dependencyId, dependents);
      activate(dependencyId);
    }
    visiting.delete(id);
    activeSet.add(id);
  }

  for (const id of normalizedRequested) activate(id);

  const skills = SKILLS.filter((skill) => activeSet.has(skill.id));
  const plugins: AiSkill["plugins"] = [];
  const pluginVersions = new Map<string, string>();
  for (const skill of skills) {
    for (const plugin of skill.plugins) {
      const registeredVersion = pluginVersions.get(plugin.name);
      if (registeredVersion && registeredVersion !== plugin.version) {
        throw new Error(
          `Agent CLI plugin 版本冲突: ${plugin.name} (${registeredVersion} / ${plugin.version})`,
        );
      }
      if (registeredVersion) continue;
      pluginVersions.set(plugin.name, plugin.version);
      plugins.push(plugin);
    }
  }

  return {
    requestedIds: SKILLS.filter((skill) => requestedSet.has(skill.id)).map((skill) => skill.id),
    activeIds: skills.map((skill) => skill.id),
    skills,
    plugins,
    requiredBy: Object.fromEntries(
      [...requiredBy].map(([id, dependents]) => [
        id,
        SKILLS.filter((skill) => dependents.has(skill.id)).map((skill) => skill.id),
      ]),
    ),
  };
}

export function buildSkillsPromptSection(resolved: ResolvedSkills): string {
  const header = `## Host-loaded skills (authoritative for this run)
Only skills in this section are loaded for the current run. Conversation history never grants CLI capabilities.
Use only commands exposed by cli_search / cli_describe. Never infer access from an earlier turn.`;

  if (!resolved.skills.length) {
    return `${header}

No Agent CLI skill is loaded. No project or database command is available. Answer without tool operations, or ask the user to enable the required skill.`;
  }

  const bodies = resolved.skills
    .map(
      (skill) => `<skill id="${skill.id}" title="${skill.title}">
${skill.body.trim()}
</skill>`,
    )
    .join("\n\n");

  return `${header}

${bodies}`;
}
