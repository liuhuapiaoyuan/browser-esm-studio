import { ddbPlugin } from "../../agent-cli/plugins/ddb";
import { sandboxPlugin } from "../../agent-cli/plugins/sandbox";
import type { AiSkill, ResolvedSkills, SkillId, SkillSummary } from "./types";
import dynamicDbSkill from "./dynamic-db/SKILL.md?raw";
import interactiveQuestSkill from "./interactive-quest/SKILL.md?raw";
import questLearningSkill from "./quest-learning/SKILL.md?raw";
import panoramaShowcaseSkill from "./panorama-showcase/SKILL.md?raw";
import sandboxSkill from "./sandbox/SKILL.md?raw";
import slideCoursewareSkill from "./slide-courseware/SKILL.md?raw";
import textInteractiveGameSkill from "./text-interactive-game/SKILL.md?raw";
import usageTrackingSkill from "./usage-tracking/SKILL.md?raw";

export type { AiSkill, ResolvedSkills, SkillId, SkillSummary };

/** Removed skills — silently ignored so old chat skillIds / follow-ups keep working. */
const REMOVED_SKILL_IDS = new Set<SkillId>(["lite-image"]);

const SKILLS: AiSkill[] = [
  {
    id: "sandbox",
    title: "课件编辑",
    motto: "落笔成页 · 即时预览",
    icon: "https://cdn.qxai666.com/skill-icons/sandbox.png",
    description: "让 AI 自动编写、修改互动页面，并在右侧实时预览效果。制作任何课件都需要启用。",
    body: sandboxSkill,
    plugins: [sandboxPlugin],
    requires: [],
    defaultEnabled: true,
  },
  {
    id: "dynamic-db",
    title: "学习数据",
    motto: "题库进度 · 有迹可循",
    icon: "https://cdn.qxai666.com/skill-icons/dynamic-db.png",
    description: "为课件添加题库、答题记录、闯关进度等数据存储，适合需要保存学生学习结果的应用。",
    body: dynamicDbSkill,
    plugins: [ddbPlugin],
    requires: ["sandbox"],
    defaultEnabled: true,
  },
  {
    id: "interactive-quest",
    title: "参考仿作",
    motto: "借形换骨 · 重写内容",
    icon: "https://cdn.qxai666.com/skill-icons/interactive-quest.png",
    description:
      "上传已有的 HTML 互动页面作为参考，AI 会仿照其玩法与界面，重新编写你的教学内容并配图。适合单元作文互动、选关地图仿作等场景。",
    body: interactiveQuestSkill,
    plugins: [],
    requires: ["sandbox"],
    defaultEnabled: false,
  },
  {
    id: "quest-learning",
    title: "地图闯关",
    motto: "选关启程 · 逐关通关",
    icon: "https://cdn.qxai666.com/skill-icons/quest-learning.png",
    description:
      "从零制作地图选关式闯关学习：封面、冒险地图、逐关答题、锦囊提示、奖励与进度。适合单元复习、知识闯关、作文闯关。",
    body: questLearningSkill,
    plugins: [],
    requires: ["sandbox"],
    defaultEnabled: false,
  },
  {
    id: "panorama-showcase",
    title: "历程全景",
    motto: "阶段铺陈 · 一览全貌",
    icon: "https://cdn.qxai666.com/skill-icons/panorama-showcase.png",
    description:
      "从零制作阶段卡片式全景学习页：标题导读、阶段封面、详情弹窗、知识测验。适合历史历程、单元概览、专题展板；无需上传素材。",
    body: panoramaShowcaseSkill,
    plugins: [],
    requires: ["sandbox"],
    defaultEnabled: false,
  },
  {
    id: "slide-courseware",
    title: "课件制作",
    motto: "大纲确认 · 翻页讲解",
    icon: "https://cdn.qxai666.com/skill-icons/slide-courseware.png",
    description:
      "从零制作像 PPT 一样翻页的多页互动课件：先与老师确认大纲，再用路由逐页讲解，页内可点可选。适合新授课、技巧手册、专题串讲；简单提示词即可。",
    body: slideCoursewareSkill,
    plugins: [],
    requires: ["sandbox"],
    defaultEnabled: false,
  },
  {
    id: "text-interactive-game",
    title: "课文互动游戏",
    motto: "沉浸对话 · 共情高潮",
    icon: "https://cdn.qxai666.com/skill-icons/text-interactive-game.png",
    description:
      "从零制作课文情景互动：封面、双人对话打字机、高潮小游戏、金句结局与旁白。适合《军神》类语文课文演绎；无需上传素材。",
    body: textInteractiveGameSkill,
    plugins: [],
    requires: ["sandbox"],
    defaultEnabled: false,
  },
  {
    id: "usage-tracking",
    title: "学情追踪",
    motto: "署名入课 · 老师可查",
    icon: "https://cdn.qxai666.com/skill-icons/usage-tracking.png",
    description:
      "为课件注入学生姓名+口令入场与使用追踪，并提供老师口令入口查看谁学过、学多久。口令未说明时 AI 会先反问再动手。",
    body: usageTrackingSkill,
    plugins: [],
    requires: ["sandbox", "dynamic-db"],
    defaultEnabled: false,
  },
];

const SKILL_BY_ID = new Map(SKILLS.map((skill) => [skill.id, skill]));

function summarize(skill: AiSkill): SkillSummary {
  return {
    id: skill.id,
    title: skill.title,
    description: skill.description,
    icon: skill.icon,
    motto: skill.motto,
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
    if (REMOVED_SKILL_IDS.has(id)) continue;
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
Use only commands exposed by cli_search / cli_describe. Never infer access from an earlier turn.
Built-in image.generate / speech.generate are separate — see Built-in capabilities.`;

  if (!resolved.skills.length) {
    return `${header}

No Agent CLI skill is loaded. Project/database commands are unavailable (built-in image/speech still work). Answer without skill tools, or ask the user to enable the required skill.`;
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
