import type { AgentCliPlugin } from "../../agent-cli";

export type SkillId = string;

export type SkillSummary = {
  id: SkillId;
  title: string;
  description: string;
  /** CDN cover URL for skill store cards (never base64). */
  icon: string;
  /** Short red motto under the title, matching educational card tone. */
  motto: string;
  requires: SkillId[];
  defaultEnabled: boolean;
};

export type AiSkill = SkillSummary & {
  body: string;
  plugins: AgentCliPlugin[];
};

export type ResolvedSkills = {
  requestedIds: SkillId[];
  activeIds: SkillId[];
  skills: AiSkill[];
  plugins: AgentCliPlugin[];
  requiredBy: Readonly<Record<SkillId, SkillId[]>>;
};
