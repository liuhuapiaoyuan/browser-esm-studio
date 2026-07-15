import { ddbPlugin } from "../../agent-cli/plugins/ddb";
import { imagePlugin } from "../../agent-cli/plugins/image";
import { sandboxPlugin } from "../../agent-cli/plugins/sandbox";
import type { AiSkill, ResolvedSkills, SkillId, SkillSummary } from "./types";
import dynamicDbSkill from "./dynamic-db/SKILL.md?raw";
import interactiveQuestSkill from "./interactive-quest/SKILL.md?raw";
import questLearningSkill from "./quest-learning/SKILL.md?raw";
import liteImageSkill from "./lite-image/SKILL.md?raw";
import sandboxSkill from "./sandbox/SKILL.md?raw";

export type { AiSkill, ResolvedSkills, SkillId, SkillSummary };

const SKILLS: AiSkill[] = [
  {
    id: "sandbox",
    title: "课件编辑",
    description: "让 AI 自动编写、修改互动页面，并在右侧实时预览效果。制作任何课件都需要启用。",
    body: sandboxSkill,
    plugins: [sandboxPlugin],
    requires: [],
    defaultEnabled: true,
  },
  {
    id: "dynamic-db",
    title: "学习数据",
    description: "为课件添加题库、答题记录、闯关进度等数据存储，适合需要保存学生学习结果的应用。",
    body: dynamicDbSkill,
    plugins: [ddbPlugin],
    requires: ["sandbox"],
    defaultEnabled: true,
  },
  {
    id: "lite-image",
    title: "AI 配图",
    description: "根据文字描述自动生成插图、背景图和关卡图标，让课件画面更生动、风格更统一。",
    body: liteImageSkill,
    plugins: [imagePlugin],
    requires: ["sandbox"],
    defaultEnabled: true,
  },
  {
    id: "interactive-quest",
    title: "参考仿作",
    description:
      "上传已有的 HTML 互动页面作为参考，AI 会仿照其玩法与界面，重新编写你的教学内容并配图。适合单元作文互动、选关地图仿作等场景。",
    body: interactiveQuestSkill,
    plugins: [],
    requires: ["sandbox", "lite-image"],
    defaultEnabled: false,
  },
  {
    id: "quest-learning",
    title: "地图闯关",
    description:
      "从零制作地图选关式闯关学习：封面、冒险地图、逐关答题、锦囊提示、奖励与进度。适合单元复习、知识闯关、作文闯关。",
    body: questLearningSkill,
    plugins: [],
    requires: ["sandbox", "lite-image"],
    defaultEnabled: false,
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
