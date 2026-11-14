import { campaigns, suggestProfessionNames } from "@gw1-mcp/gw-data";
import { jsonError } from "../results.js";

/** One shape for a filter value that names no profession, on every tool that takes one. */
export const unknownProfession = (name: string) =>
  jsonError("UNKNOWN_PROFESSION", `Unknown profession ${JSON.stringify(name)}`, {
    suggestions: suggestProfessionNames(name),
  });

/** Same for campaigns: five names, so the suggestion is simply all of them. */
export const unknownCampaign = (name: string) =>
  jsonError("UNKNOWN_CAMPAIGN", `Unknown campaign ${JSON.stringify(name)}`, {
    suggestions: campaigns.map((c) => c.name),
  });
