import { z } from "zod";
import {
  getAttributeByName,
  getProfessionByName,
  getSkillByName,
  getAttributeById,
  getProfessionById,
  getSkillById,
  suggestSkillNames,
} from "@gw1-mcp/gw-data";
import type { SkillTemplate } from "@gw1-mcp/gw-template";

/**
 * The LLM-facing build format: exact names in, no ids required.
 * The MCP acts as the compiler that resolves names to template ids.
 */
export interface NamedBuild {
  primary: string;
  secondary?: string | undefined;
  attributes: Array<{ attribute: string; rank: number }>;
  /** Exactly 8 entries; null or "" = empty slot. */
  skills: Array<string | null>;
}

export interface ResolutionError {
  code: "UNKNOWN_PROFESSION" | "UNKNOWN_ATTRIBUTE" | "UNKNOWN_SKILL";
  message: string;
  suggestions?: string[];
}

export function resolveNamedBuild(
  build: NamedBuild,
): { template: SkillTemplate; errors: [] } | { template: null; errors: ResolutionError[] } {
  const errors: ResolutionError[] = [];

  const primary = getProfessionByName(build.primary);
  if (!primary) {
    errors.push({
      code: "UNKNOWN_PROFESSION",
      message: `Unknown profession: ${JSON.stringify(build.primary)}`,
    });
  }
  const secondaryName = build.secondary?.trim();
  const secondary =
    secondaryName === undefined || secondaryName === "" || /^none$/i.test(secondaryName)
      ? { id: 0 }
      : getProfessionByName(secondaryName);
  if (!secondary) {
    errors.push({
      code: "UNKNOWN_PROFESSION",
      message: `Unknown profession: ${JSON.stringify(build.secondary)}`,
    });
  }

  const attributes: SkillTemplate["attributes"] = [];
  for (const { attribute, rank } of build.attributes) {
    const resolved = getAttributeByName(attribute);
    if (!resolved) {
      errors.push({
        code: "UNKNOWN_ATTRIBUTE",
        message: `Unknown attribute: ${JSON.stringify(attribute)}`,
      });
      continue;
    }
    attributes.push({ attributeId: resolved.id, rank });
  }

  const skills: number[] = [];
  for (const name of build.skills) {
    if (name === null || name.trim() === "") {
      skills.push(0);
      continue;
    }
    const skill = getSkillByName(name);
    if (!skill) {
      errors.push({
        code: "UNKNOWN_SKILL",
        message: `Unknown skill: ${JSON.stringify(name)}`,
        suggestions: suggestSkillNames(name),
      });
      continue;
    }
    skills.push(skill.id);
  }

  // Early return on any resolution failure; past this point the compiler
  // can prove primary and secondary are resolved (no ! or cast needed).
  if (errors.length > 0 || !primary || !secondary) {
    return { template: null, errors };
  }
  return {
    template: {
      primary: primary.id,
      secondary: secondary.id,
      attributes,
      skills,
    },
    errors: [],
  };
}

/** Enriched, human/LLM-readable view of a decoded template. */
export const decodedSkillSchema = z.object({
  slot: z.number().int().describe("Bar position 1-8"),
  name: z.string().nullable().describe("null for an empty bar slot"),
  elite: z.boolean().optional(),
  isRoleplay: z
    .boolean()
    .optional()
    .describe("PvE-only skill: max 3 per player bar, none on heroes"),
  attribute: z.string().nullable().optional(),
  energy: z.number().optional(),
  activation: z.number().optional(),
  recharge: z.number().optional(),
  adrenaline: z.number().optional(),
  sacrifice: z.number().optional(),
  description: z.string().optional(),
});

export const decodedBuildShape = {
  primary: z.string().describe("Primary profession name"),
  secondary: z.string().nullable().describe("Secondary profession name, null for none"),
  attributes: z.array(z.object({ attribute: z.string(), rank: z.number().int() })),
  skills: z.array(decodedSkillSchema).describe("The 8 bar slots in order"),
  raw: z.unknown().describe("The raw decoded template (ids, not names)"),
};

export type DecodedBuild = z.infer<z.ZodObject<typeof decodedBuildShape>>;

export function describeTemplate(template: SkillTemplate) {
  return {
    primary: getProfessionById(template.primary)?.name ?? `Unknown (${template.primary})`,
    secondary:
      template.secondary === 0
        ? null
        : (getProfessionById(template.secondary)?.name ?? `Unknown (${template.secondary})`),
    attributes: template.attributes.map(({ attributeId, rank }) => ({
      attribute: getAttributeById(attributeId)?.name ?? `Unknown (${attributeId})`,
      rank,
    })),
    skills: template.skills.map((id, index) => {
      if (id === 0) return { slot: index + 1, name: null };
      const skill = getSkillById(id);
      return skill
        ? {
            slot: index + 1,
            name: skill.name,
            elite: skill.elite,
            isRoleplay: skill.isRoleplay,
            attribute: getAttributeById(skill.attributeId)?.name ?? null,
            energy: skill.energy,
            activation: skill.activation,
            recharge: skill.recharge,
            adrenaline: skill.adrenaline,
            sacrifice: skill.sacrifice,
            description: skill.description,
          }
        : { slot: index + 1, name: `Unknown skill id ${id}` };
    }),
    raw: template,
  };
}
