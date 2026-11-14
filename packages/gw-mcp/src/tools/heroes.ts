import {
  READ_ONLY,
  fullHeroSchema,
  getHeroInputObject,
  listHeroesInputObject,
  listHeroesOutputObject,
} from "../schemas.js";
import {
  suggestHeroNames,
  getHeroById,
  getHeroByName,
  getProfessionByName,
  heroes,
  getCampaignByName,
} from "@gw1-mcp/gw-data";
import { fullHero, jsonError, jsonStructured } from "../results.js";
import { unknownProfession, unknownCampaign } from "./filter-errors.js";
import type { ToolName } from "../tool-names.js";
import type { RegisterTool } from "./register-tool.js";

export function registerHeroesTools(registerTool: RegisterTool): void {
  registerTool(
    "get_hero" satisfies ToolName,
    {
      title: "Get a Guild Wars 1 hero",
      description:
        "Look up a GW1 hero by name or by id (GWCA HeroID, matching the AccountExport plugin output). Returns profession, campaign and how the hero is unlocked. Remember: heroes can equip any skill unlocked at ACCOUNT level, but NO PvE-only skill at all — including Signet of Capture. validate_build with forHero=true reports each one as an error, not a warning. Use this for one known hero; to browse or filter the roster, use list_heroes instead.",
      annotations: READ_ONLY,
      outputSchema: fullHeroSchema.shape,
      inputSchema: getHeroInputObject,
    },
    async ({ name, id }) => {
      // Both branches mirror get_skill: "exactly one" means neither is a bad
      // REQUEST, not a lookup that missed. Without the second branch the call
      // answered NOT_FOUND: "No hero matching undefined" — the wrong taxonomy
      // code (NOT_FOUND is for a direct lookup that missed) and a message that
      // told the caller nothing about what to send instead (audit L6).
      if (name !== undefined && id !== undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id, not both");
      }
      if (name === undefined && id === undefined) {
        return jsonError("BAD_REQUEST", "Provide exactly one of name or id");
      }
      const hero =
        name !== undefined ? getHeroByName(name) : id !== undefined ? getHeroById(id) : undefined;
      if (!hero) {
        return jsonError("NOT_FOUND", `No hero matching ${JSON.stringify(name ?? id)}`, {
          suggestions: name !== undefined ? suggestHeroNames(name) : [],
        });
      }
      return jsonStructured(fullHero(hero));
    },
  );
  registerTool(
    "list_heroes" satisfies ToolName,
    {
      title: "List Guild Wars 1 heroes",
      description:
        "List all GW1 heroes, optionally filtered by profession or campaign name. Useful for team-building: shows which professions are coverable by heroes and how each hero is unlocked.",
      annotations: READ_ONLY,
      outputSchema: listHeroesOutputObject,
      inputSchema: listHeroesInputObject,
    },
    async ({ professionName, campaignName }) => {
      let results = heroes;
      if (professionName !== undefined) {
        const profession = getProfessionByName(professionName);
        if (!profession) return unknownProfession(professionName);
        results = results.filter((h) => h.professionId === profession.id);
      }
      if (campaignName !== undefined) {
        const campaign = getCampaignByName(campaignName);
        if (!campaign) return unknownCampaign(campaignName);
        results = results.filter((h) => h.campaignId === campaign.id);
      }
      return jsonStructured({
        total: results.length,
        heroes: results.map(fullHero),
      });
    },
  );
}
