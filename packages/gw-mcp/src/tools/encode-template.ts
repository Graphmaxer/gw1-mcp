import { READ_ONLY, encodeInputObject, encodeResultSchemaObject } from "../schemas.js";
import { encodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { resolveNamedBuild } from "../build-io.js";
import { validateBuild } from "../validate.js";
import { jsonError, jsonStructured } from "../results.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerEncodeTemplateTool(registerTool: RegisterTool): void {
  registerTool(
    "encode_template" satisfies ToolName,
    {
      title: "Encode a build into a template code",
      description:
        "Compile a build (professions, attributes, 8 skills by exact English name) into an official in-game template code. The build is validated first; on rule violations the errors are returned instead of a code. Unknown skill names return closest-match suggestions. IMPORTANT: template codes MUST come from this tool — never write or guess a code by hand, hand-written codes are invalid in-game. If unsure, verify any code with decode_template.",
      annotations: READ_ONLY,
      outputSchema: encodeResultSchemaObject,
      inputSchema: encodeInputObject,
    },
    async ({ forHero, forPvp, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) return jsonStructured({ errors: resolution.errors });

      const validation = validateBuild(resolution.template, { forHero, forPvp, unlockedSkillIds });
      if (!validation.valid) return jsonStructured(validation);

      try {
        return jsonStructured({
          code: encodeTemplate(resolution.template),
          warnings: validation.warnings,
        });
      } catch (error) {
        if (error instanceof TemplateError) {
          return jsonError(error.code, error.message);
        }
        throw error;
      }
    },
  );
}
