import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  campaigns,
  getAttributeByName,
  getProfessionByName,
  getSkillByName,
  getSkillById,
  getAttribute,
  getCampaign,
  getProfession,
  getSkillType,
  searchSkills,
  suggestSkillNames,
} from "@gw1-mcp/gw-data";
import { decodeTemplate, encodeTemplate, TemplateError } from "@gw1-mcp/gw-template";
import { describeTemplate, resolveNamedBuild } from "./build-io.js";
import { validateBuild } from "./validate.js";

const namedBuildSchema = {
  primary: z.string().describe('Primary profession, e.g. "Dervish"'),
  secondary: z
    .string()
    .optional()
    .describe('Secondary profession, e.g. "Monk". Omit or "None" for none.'),
  attributes: z
    .array(
      z.object({
        attribute: z.string().describe('Exact attribute name, e.g. "Mysticism"'),
        rank: z.number().int().min(0).max(12).describe("Base rank 0-12 (before runes)"),
      }),
    )
    .describe("Attribute point allocations"),
  skills: z
    .array(z.string().nullable())
    .length(8)
    .describe(
      "Exactly 8 skill names in bar order. Use null for an empty slot. Names must be exact English skill names.",
    ),
};

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fullSkill(id: number) {
  const skill = getSkillById(id);
  if (!skill) return null;
  return {
    ...skill,
    profession: getProfession(skill.professionId)?.name ?? null,
    attribute: getAttribute(skill.attributeId)?.name ?? null,
    campaign: getCampaign(skill.campaignId)?.name ?? null,
    type: getSkillType(skill.typeId)?.name ?? null,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: "gw1-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "get_skill",
    {
      title: "Get a Guild Wars 1 skill",
      description:
        "Look up a single GW1 skill by exact English name or by template skill id. Returns full stats (energy, activation, recharge, adrenaline, sacrifice), profession, attribute, campaign, elite flag and description. If the name is not found, returns the closest matches so you can correct spelling.",
      inputSchema: {
        name: z.string().optional().describe('Exact English skill name, e.g. "Mystic Regeneration"'),
        id: z.number().int().optional().describe("Template skill id"),
      },
    },
    async ({ name, id }) => {
      if (id !== undefined) {
        const skill = fullSkill(id);
        return skill
          ? json(skill)
          : json({ error: { code: "NOT_FOUND", message: `No skill with id ${id}` } });
      }
      if (name !== undefined) {
        const skill = getSkillByName(name);
        return skill
          ? json(fullSkill(skill.id))
          : json({
              error: {
                code: "NOT_FOUND",
                message: `No skill named ${JSON.stringify(name)}`,
                suggestions: suggestSkillNames(name),
              },
            });
      }
      return json({ error: { code: "BAD_REQUEST", message: "Provide name or id" } });
    },
  );

  server.registerTool(
    "search_skills",
    {
      title: "Search Guild Wars 1 skills",
      description:
        "Search the full GW1 skill database with filters. professionName: Warrior, Ranger, Monk, Necromancer, Mesmer, Elementalist, Assassin, Ritualist, Paragon, Dervish, or None (common/PvE-only skills). campaignName: Core, Prophecies, Factions, Nightfall, Eye of the North. Returns compact records; use get_skill for full details.",
      inputSchema: {
        professionName: z.string().optional(),
        attributeName: z.string().optional(),
        campaignName: z.string().optional(),
        elite: z.boolean().optional(),
        nameContains: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ professionName, attributeName, campaignName, elite, nameContains, limit }) => {
      const filters: Parameters<typeof searchSkills>[0] = {};
      if (professionName !== undefined) {
        if (/^none$/i.test(professionName)) filters.professionId = 0;
        else {
          const profession = getProfessionByName(professionName);
          if (!profession)
            return json({ error: { code: "UNKNOWN_PROFESSION", message: `Unknown profession ${JSON.stringify(professionName)}` } });
          filters.professionId = profession.id;
        }
      }
      if (attributeName !== undefined) {
        const attribute = getAttributeByName(attributeName);
        if (!attribute)
          return json({ error: { code: "UNKNOWN_ATTRIBUTE", message: `Unknown attribute ${JSON.stringify(attributeName)}` } });
        filters.attributeId = attribute.id;
      }
      if (campaignName !== undefined) {
        const campaign = campaigns.find(
          (c) => c.name.toLowerCase() === campaignName.toLowerCase(),
        );
        if (!campaign)
          return json({ error: { code: "UNKNOWN_CAMPAIGN", message: `Unknown campaign ${JSON.stringify(campaignName)}` } });
        filters.campaignId = campaign.id;
      }
      if (elite !== undefined) filters.elite = elite;
      if (nameContains !== undefined) filters.nameContains = nameContains;

      const results = searchSkills(filters);
      return json({
        total: results.length,
        skills: results.slice(0, limit).map((s) => ({
          id: s.id,
          name: s.name,
          elite: s.elite,
          profession: getProfession(s.professionId)?.name ?? null,
          attribute: getAttribute(s.attributeId)?.name ?? null,
          campaign: getCampaign(s.campaignId)?.name ?? null,
          energy: s.energy,
          activation: s.activation,
          recharge: s.recharge,
        })),
      });
    },
  );

  server.registerTool(
    "decode_template",
    {
      title: "Decode a skill template code",
      description:
        "Decode an in-game GW1 skill template code (e.g. \"OwpiMypMBg1cxcBAMBdmtIKAA\") into professions, attribute allocations and the 8 skills with their stats and descriptions.",
      inputSchema: {
        code: z.string().describe("The template code string"),
      },
    },
    async ({ code }) => {
      try {
        return json(describeTemplate(decodeTemplate(code)));
      } catch (error) {
        if (error instanceof TemplateError) {
          return json({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "encode_template",
    {
      title: "Encode a build into a template code",
      description:
        "Compile a build (professions, attributes, 8 skills by exact English name) into an official in-game template code. The build is validated first; on rule violations the errors are returned instead of a code. Unknown skill names return closest-match suggestions.",
      inputSchema: {
        ...namedBuildSchema,
        forHero: z
          .boolean()
          .default(false)
          .describe("Set true if this bar is for a hero (PvE-only skills are flagged)"),
        unlockedSkillIds: z
          .array(z.number().int())
          .optional()
          .describe(
            "Optional: unlocked skill ids from a Kormir account export (/kormir in GWToolbox). Skills outside this list are flagged as warnings.",
          ),
      },
    },
    async ({ forHero, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) return json({ errors: resolution.errors });

      const validation = validateBuild(resolution.template, {
        forHero,
        ...(unlockedSkillIds !== undefined ? { unlockedSkillIds } : {}),
      });
      if (!validation.valid) return json(validation);

      return json({
        code: encodeTemplate(resolution.template),
        warnings: validation.warnings,
      });
    },
  );

  server.registerTool(
    "validate_build",
    {
      title: "Validate a build against GW1 rules",
      description:
        "Check a build (professions, attributes, 8 skills by exact English name) against Guild Wars 1 rules: one elite max, profession/attribute ownership, primary attributes, duplicates, rank ranges. Returns { valid, errors, warnings } without encoding.",
      inputSchema: {
        ...namedBuildSchema,
        forHero: z.boolean().default(false),
        unlockedSkillIds: z
          .array(z.number().int())
          .optional()
          .describe(
            "Optional: unlocked skill ids from a Kormir account export (/kormir in GWToolbox). Skills outside this list are flagged as warnings.",
          ),
      },
    },
    async ({ forHero, unlockedSkillIds, ...build }) => {
      const resolution = resolveNamedBuild(build);
      if (!resolution.template) {
        return json({ valid: false, errors: resolution.errors, warnings: [] });
      }
      return json(
        validateBuild(resolution.template, {
          forHero,
          ...(unlockedSkillIds !== undefined ? { unlockedSkillIds } : {}),
        }),
      );
    },
  );

  return server;
}
