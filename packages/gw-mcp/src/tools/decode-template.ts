import { READ_ONLY, decodeTemplateInputObject, decodedBuildShapeObject } from "../schemas.js";
import { decodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { describeTemplate } from "../build-io.js";
import { jsonError, jsonStructured } from "../results.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerDecodeTemplateTool(registerTool: RegisterTool): void {
  registerTool(
    "decode_template" satisfies ToolName,
    {
      title: "Decode a skill template code",
      description:
        'Decode an in-game GW1 skill template code (e.g. "OwpiMypMBg1cxcBAMBdmtIKAA") into professions, attribute allocations and the 8 skills with their stats and descriptions. Whitespace and line wraps in the pasted code are tolerated. This decodes a SINGLE build code; for a multi-hero paw-ned2 team blob, use decode_pawned_team instead.',
      annotations: READ_ONLY,
      outputSchema: decodedBuildShapeObject,
      inputSchema: decodeTemplateInputObject,
    },
    async ({ code }) => {
      try {
        // Strip whitespace ANYWHERE in the code, not just at the ends, mirroring
        // what decode_pawned_team already does to its payload. A code copied out
        // of a forum post, a wiki table or a chat message routinely arrives split
        // across two lines, and the codec is strictly right to refuse it —
        // whitespace is not in the charset — but that strictness belongs at the
        // codec boundary, not at the paste surface. Before this, such a code came
        // back INVALID_CHARACTER, which reads to a model as "this code is wrong"
        // rather than "rejoin it and retry", so it would go and invent another.
        // The length bound in the schema still applies to the RAW argument, so
        // stripping cannot be used to smuggle a longer payload past it.
        return jsonStructured(describeTemplate(decodeTemplate(code.replace(/\s+/g, ""))));
      } catch (error) {
        if (error instanceof TemplateError) {
          return jsonError(error.code, error.message);
        }
        throw error;
      }
    },
  );
}
