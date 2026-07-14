/**
 * Imports game data from build-wars/gw-skilldata (MIT) into
 * packages/gw-data/data/*.json.
 *
 * The upstream is actively maintained and tracks Guild Wars Reforged balance
 * updates (including newly added skills). Three source modes (see
 * `loadUpstream` below): the npm package (default, local dev), the upstream's
 * published GitHub Pages release files (an https URL — what the weekly
 * workflow uses), or a local git clone (a path — offline use). Examples:
 *
 *   pnpm --filter @gw1-mcp/gw-data update @buildwars/gw-skilldata --latest
 *   pnpm --filter @gw1-mcp/gw-data run import:data
 *   pnpm --filter @gw1-mcp/gw-data run import:data -- https://build-wars.github.io/gw-skilldata
 *
 * The generated JSON is committed: the MCP server never fetches at runtime.
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadUpstream } from "./import/load.js";
import {
  transformAttributes,
  transformCampaigns,
  transformProfessions,
  transformSkills,
  transformSkillTypes,
} from "./import/transform.js";
import { mergeProvenance, writeData } from "./import/write.js";

async function main(): Promise<void> {
  const upstream = await loadUpstream(process.argv[2]);

  const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
  mkdirSync(outDir, { recursive: true });

  const campaigns = transformCampaigns(upstream.CAMPAIGNS);
  const professions = transformProfessions(upstream.PROFESSIONS);
  const attributes = transformAttributes(upstream.ATTRIBUTES);
  const skillTypes = transformSkillTypes(upstream.SKILLTYPES);
  const skills = transformSkills(upstream);

  writeData(outDir, "campaigns.json", campaigns, campaigns.length);
  writeData(outDir, "professions.json", professions, professions.length);
  writeData(outDir, "attributes.json", attributes, attributes.length);
  writeData(outDir, "skill-types.json", skillTypes, skillTypes.length);
  writeData(
    outDir,
    "skills.json",
    skills,
    `${skills.length} (${skills.filter((s) => s.isPvpVersion).length} PvP versions)`,
  );
  mergeProvenance(outDir, "skills", {
    source: "https://github.com/build-wars/gw-skilldata (npm: @buildwars/gw-skilldata)",
    sourceVersion: upstream.version,
    importedAt: new Date().toISOString().slice(0, 10),
    freshness:
      "Upstream is actively maintained and tracks Guild Wars Reforged balance updates (stat changes and newly added skills). Data is only as fresh as the installed package version; run the update workflow or `pnpm update @buildwars/gw-skilldata` to refresh. Recent balance notes: https://wiki.guildwars.com/wiki/Game_updates",
  });
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
