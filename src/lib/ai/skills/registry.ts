import type { AiSkill } from "./types";
import dynamicDbSkill from "./dynamic-db/SKILL.md?raw";

export type { AiSkill };

const SKILLS: AiSkill[] = [
  {
    name: "dynamic-db",
    description:
      "Dynamic DB：schema/seed 用 dynamicDb 工具；业务 CRUD 用 getDb()；setupSchema → codegen → kindNames",
    body: dynamicDbSkill,
  },
];

export function listSkills(): AiSkill[] {
  return SKILLS.map(({ name, description }) => ({ name, description, body: "" }));
}

export function getSkill(name: string): AiSkill | null {
  const key = name.trim().toLowerCase();
  return SKILLS.find((s) => s.name === key) ?? null;
}

export function buildSkillsPromptSection(): string {
  const rows = SKILLS.map((s) => `- \`${s.name}\`: ${s.description}`).join("\n");
  return `Available skills (call loadSkill before deep work):\n${rows}`;
}
