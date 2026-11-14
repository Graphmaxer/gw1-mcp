import { READ_ONLY, fullSkillShapeObject, getSkillInputObject } from "../schemas.js";
import { getSkillById, getSkillByName, suggestSkillNames } from "@gw1-mcp/gw-data";
import { fullSkill, jsonError, jsonStructured } from "../results.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerGetSkillTool(registerTool: RegisterTool): void {
  registerTool(
    "get_skill" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 skill",
      description:
        "Look up a single GW1 skill by exact English or official French name, or by template skill id. Returns full stats (energy, activation, recharge, adrenaline, sacrifice), profession, attribute, campaign, elite flag and description. If the name is not found, returns the closest matches so you can correct spelling. Use this when you already know the exact skill; to discover skills by profession, attribute or name fragment, use search_skills instead.",
      annotations: READ_ONLY,
      outputSchema: fullSkillShapeObject,
      inputSchema: getSkillInputObject,
    },
    async ({ name, id }) => {
      // Exactly one of name/id — accepting both and silently letting id win
      // (GW1-09) hides a caller mistake where the name means something else.
      if (name !== undefined && id !== undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id, not both");
      }
      if (id !== undefined) {
        const skill = getSkillById(id);
        return skill
          ? jsonStructured(fullSkill(skill))
          : jsonError("NOT_FOUND", `No skill with id ${id}`);
      }
      if (name !== undefined) {
        const skill = getSkillByName(name);
        return skill
          ? jsonStructured(fullSkill(skill))
          : jsonError("NOT_FOUND", `No skill named ${JSON.stringify(name)}`, {
              suggestions: suggestSkillNames(name),
            });
      }
      return jsonError("BAD_REQUEST", "Provide name or id");
    },
  );
}
