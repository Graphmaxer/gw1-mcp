import { MAX_PWND_SLOTS, READ_ONLY, decodePwndInputObject, pwndOutputObject } from "../schemas.js";
import { decodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { PwndTemplate } from "@buildwars/gw-templates";
import { describeTemplate, type DecodedBuild } from "../build-io.js";
import { jsonError, jsonStructured, pwndSlotLabel, rejoinWrappedPwnd } from "../results.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerDecodePawnedTeamTool(registerTool: RegisterTool): void {
  registerTool(
    "decode_pawned_team" satisfies ToolName,
    {
      title: "Decode a paw-ned2 team template",
      description:
        "Decode a paw-ned2 team build blob (the 'pwnd0001...>...<' format shared on PvXwiki team pages and by the paw-ned2 tool) into its individual builds: player/hero label, description, and each skill bar fully decoded. Whitespace and line wraps in the pasted blob are tolerated. For a single (non-team) build code, use decode_template instead.",
      annotations: READ_ONLY,
      outputSchema: pwndOutputObject,
      inputSchema: decodePwndInputObject,
    },
    async ({ pwnd }) => {
      const cleaned = rejoinWrappedPwnd(pwnd);
      let entries;
      try {
        entries = new PwndTemplate().decode(cleaned);
      } catch (error) {
        return jsonError("INVALID_PWND", error instanceof Error ? error.message : String(error));
      }
      if (entries.length > MAX_PWND_SLOTS) {
        return jsonError(
          "TOO_MANY_SLOTS",
          `Blob declares ${entries.length} slots; a paw-ned2 team holds at most 8 (limit ${MAX_PWND_SLOTS}). This is not a team blob.`,
        );
      }

      return jsonStructured({
        builds: entries.map((entry, index) => {
          let build: DecodedBuild | undefined;
          let buildError: { code: string; message: string } | undefined;
          // No per-slot length bound here, and none is possible to need: the pwnd
          // format encodes each field's length in a SINGLE base64 character, so a
          // slot's code cannot exceed 63 characters. Both sides enforce it —
          // encode writes `base64_chr(str.length)`, decode reads
          // `read(base64_ord(read(1)))`. A 128-character guard was added here and
          // removed the same day: Codecov flagged it as uncovered, and it was
          // uncovered because it is unreachable, not because a test was missing.
          try {
            build = describeTemplate(decodeTemplate(entry.skills));
          } catch (error) {
            buildError = {
              code: error instanceof TemplateError ? error.code : "DECODE_FAILED",
              message: error instanceof Error ? error.message : String(error),
            };
          }
          // Both upstream shapes handled in one pure helper; see pwndSlotLabel.
          const { label, notes } = pwndSlotLabel(
            // Cast because the shipped TYPES lag the implementation: 1.1.1 returns
            // templatename at runtime but declares only skills, equipment, weaponsets,
            // player, description and flags. Reported upstream; remove when they catch up.
            (entry as { templatename?: string }).templatename,
            entry.description,
          );
          return {
            slot: index + 1,
            label,
            notes,
            inGamePlayerName: entry.player || null,
            skillsCode: entry.skills,
            equipmentCode: entry.equipment || null,
            ...(build !== undefined ? { build } : { error: buildError }),
          };
        }),
      });
    },
  );
}
