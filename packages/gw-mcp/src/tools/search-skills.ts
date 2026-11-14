import {
  READ_ONLY,
  searchSkillsInputObject,
  searchSkillsOutputObject,
  type skillSummarySchema,
} from "../schemas.js";
import {
  getAttributeByName,
  suggestAttributeNames,
  getProfessionByName,
  getAttributeById,
  getCampaignById,
  getProfessionById,
  searchSkills,
  getCampaignByName,
} from "@gw1-mcp/gw-data";
import { jsonError, jsonStructured } from "../results.js";
import { unknownProfession, unknownCampaign } from "./filter-errors.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";
import type { z } from "zod";

export function registerSearchSkillsTool(registerTool: RegisterTool): void {
  registerTool(
    "search_skills" satisfies ToolName,
    {
      title: "Search Guild Wars 1 skills",
      description:
        "Search the full GW1 skill database by profession, attribute, campaign, elite flag or name fragment (valid values are documented per parameter). Returns compact records, at most `limit` of them alongside a `total` count of every match — a full page is not the whole result, page with offset. Use get_skill for full details.",
      annotations: READ_ONLY,
      outputSchema: searchSkillsOutputObject,
      inputSchema: searchSkillsInputObject,
    },
    async ({
      professionName,
      attributeName,
      campaignName,
      elite,
      nameContains,
      includePvpVersions,
      limit,
      offset,
    }) => {
      const filters: Parameters<typeof searchSkills>[0] = { includePvpVersions };
      if (professionName !== undefined) {
        if (/^none$/i.test(professionName)) filters.professionId = 0;
        else {
          const profession = getProfessionByName(professionName);
          if (!profession) return unknownProfession(professionName);
          filters.professionId = profession.id;
        }
      }
      if (attributeName !== undefined) {
        const attribute = getAttributeByName(attributeName);
        if (!attribute)
          return jsonError(
            "UNKNOWN_ATTRIBUTE",
            // Suggestions go in the FIELD issueSchema documents, not inside the
            // prose — get_skill has always used the field, and one idea in two
            // shapes makes a caller parse text to recover data it was handed.
            `Unknown attribute ${JSON.stringify(attributeName)}. Title tracks and each profession's attribute lines are listed in the gw1://meta resource.`,
            { suggestions: suggestAttributeNames(attributeName) },
          );
        filters.attributeId = attribute.id;
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign) return unknownCampaign(campaignName);
        filters.campaignId = campaign.id;
      }
      if (elite !== undefined) filters.elite = elite;
      if (nameContains !== undefined) filters.nameContains = nameContains;

      const results = searchSkills(filters);
      return jsonStructured({
        total: results.length,
        skills: results.slice(offset, offset + limit).map(
          (s) =>
            ({
              id: s.id,
              name: s.name,
              elite: s.elite,
              profession: getProfessionById(s.professionId)?.name ?? null,
              attribute: getAttributeById(s.attributeId)?.name ?? null,
              campaign: getCampaignById(s.campaignId)?.name ?? null,
              energy: s.energy,
              activation: s.activation,
              recharge: s.recharge,
            }) satisfies z.infer<typeof skillSummarySchema>,
        ),
      });
    },
  );
}
