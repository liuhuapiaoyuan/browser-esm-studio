import { tool } from "ai";
import { z } from "zod";
import { getSkill, listSkills } from "./skills/registry";

export function createSkillTools() {
  return {
    loadSkill: tool({
      description:
        "Load a skill playbook by name (e.g. dynamic-db). Call before deep Dynamic DB / persistence work (then use cli_* + ddb.*).",
      inputSchema: z.object({
        name: z.string().describe("Skill name, e.g. dynamic-db"),
      }),
      execute: async ({ name }) => {
        const skill = getSkill(name);
        if (!skill) {
          return {
            ok: false as const,
            error: `未知 skill: ${name}`,
            available: listSkills().map((s) => s.name),
          };
        }
        return {
          ok: true as const,
          name: skill.name,
          description: skill.description,
          body: skill.body,
        };
      },
    }),
  };
}
