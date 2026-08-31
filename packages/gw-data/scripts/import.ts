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
import { loadUpstream } from "./import/load.ts";
import {
  transformAttributes,
  transformCampaigns,
  transformFrenchNames,
  transformProfessions,
  transformSkills,
  transformSkillTypes,
} from "./import/transform.ts";
import { mergeProvenance, syncReadmeSkillCount, writeData } from "./import/write.ts";

/**
 * `pnpm run import:data -- <url>` forwards the literal "--" token into this
 * script's argv (pnpm does not strip it, unlike some other tools) — so
 * process.argv was ["--", "<url>"], not ["<url>"]. load.ts's source
 * detection then saw the string "--", which doesn't match /^https?:\/\//,
 * and treated it as a local clone path, trying to import
 * "<cwd>/--/es6/constants.js" and crashing. This silently defeated the
 * Pages import on every single run since the workflow was written; the npm
 * fallback masked it as "working as designed" for months.
 */
export function resolveSourceArg(argv: string[]): string | undefined {
  return argv.filter((a) => a !== "--")[0];
}

async function main(): Promise<void> {
  const upstream = await loadUpstream(resolveSourceArg(process.argv.slice(2)));

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
  // French names, when the channel serves them (npm 2.0.0 does not — see the
  // skilldescFr doc in load.ts). Absence deliberately LEAVES the committed file
  // alone instead of writing an empty one: the weekly job falls back to npm on a
  // Pages outage, and a fallback that deleted 1485 French names would turn a
  // transient upstream hiccup into a data-loss PR. Logged either way, because a
  // green run that silently changed channel is the exact failure this repo has
  // had twice.
  if (upstream.skilldescFr === undefined) {
    console.log(
      "skill-names-fr.json: NOT REFRESHED — this source serves no French " +
        "(npm <= 2.0.0 exports English and German only); committed names left as they are",
    );
  } else {
    const french = transformFrenchNames(upstream.skilldescFr, skills);
    writeData(
      outDir,
      "skill-names-fr.json",
      french.names,
      `${Object.keys(french.names).length} French names ` +
        `(${french.identical.length} identical to English, ` +
        `${french.shadowed.length} shadowed by an English name, ` +
        `${french.ambiguous.length} ambiguous — the last two resolve to English / to nothing)`,
    );
    // Printed, not merely counted: these are the entries whose LOOKUP behaviour is
    // surprising, and the weekly PR auto-merges, so the run log is where a reviewer
    // gets to see a new one appear.
    for (const { id, frenchName, englishIds } of french.shadowed) {
      console.log(
        `  shadowed: skill ${id} French name ${JSON.stringify(frenchName)} is the English name of ${englishIds.join(", ")}`,
      );
    }
    for (const { normalized, ids } of french.ambiguous) {
      console.log(
        `  ambiguous: French name ${JSON.stringify(normalized)} claimed by ${ids.join(", ")}`,
      );
    }
    mergeProvenance(outDir, "skillNamesFr", {
      source:
        "https://github.com/build-wars/gw-skilldata (json/skilldesc-fr.json — French NAMES only; no French descriptions are shipped)",
      sourceVersion: upstream.version,
      importedAt: new Date().toISOString().slice(0, 10),
      freshness:
        "Its OWN key because availability is independent of the skills pipeline: only the Pages and clone channels serve French (npm 2.0.0 exports English and German only), so an npm-fallback run refreshes skills.json and leaves this table untouched. A sourceVersion older than the skills entry means the last import ran without a French channel, not that anything failed.",
    });
  }

  // README advertises the count and repository.test.ts asserts it exactly, so the
  // generator owns it — otherwise an upstream count change reds the weekly job
  // until a human edits prose (which is what happened on 2026-08-10).
  const readmePath = join(outDir, "..", "..", "..", "README.md");
  const rewritten = syncReadmeSkillCount(readmePath, skills.length);
  if (rewritten > 0)
    console.log(`README.md: ${rewritten} skill-count mention(s) -> ${skills.length}`);

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
