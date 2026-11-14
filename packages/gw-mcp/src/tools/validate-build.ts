import { READ_ONLY, validateInputObject, validateResultSchemaObject } from "../schemas.js";
import { resolveNamedBuild } from "../build-io.js";
import { validateBuild } from "../validate.js";
import { jsonStructured } from "../results.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerValidateBuildTool(registerTool: RegisterTool): void {
  registerTool(
    "validate_build" satisfies ToolName,
    {
      title: "Validate a build against GW1 rules",
      description:
        "Check a build (professions, attributes, 8 skills by exact English name) against Guild Wars 1 rules: one elite max, profession/attribute ownership, primary attributes, duplicates, rank ranges. Returns { valid, errors, warnings } without encoding — use encode_template instead when you also want the template code, since it runs these same rules and refuses on any error.",
      annotations: READ_ONLY,
      outputSchema: validateResultSchemaObject,
      inputSchema: validateInputObject,
    },
    async ({ forHero, forPvp, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) {
        return jsonStructured({ valid: false, errors: resolution.errors, warnings: [] });
      }
      return jsonStructured(
        validateBuild(resolution.template, { forHero, forPvp, unlockedSkillIds }),
      );
    },
  );
}
