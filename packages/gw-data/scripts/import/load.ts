import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "./upstream-schema.js";

export interface Upstream {
  ATTRIBUTES: unknown;
  CAMPAIGNS: unknown;
  PROFESSIONS: unknown;
  SKILLTYPES: unknown;
  skilldata: Record<string, unknown>;
  skilldesc: Record<string, unknown>;
  version: string;
}

/**
 * Data source resolution (see the entry-point doc): no argument = the npm
 * package; an http(s) URL = the upstream's GitHub Pages release files; a
 * filesystem path = a local git clone.
 */
export async function loadUpstream(source: string | undefined): Promise<Upstream> {
  const cloneRoot = source && !/^https?:\/\//.test(source) ? source : undefined;
  const pagesBase = source && /^https?:\/\//.test(source) ? source.replace(/\/$/, "") : undefined;

  if (pagesBase) {
    const fetchText = async (path: string): Promise<string> => {
      const response = await fetch(`${pagesBase}/${path}`);
      if (!response.ok) throw new Error(`GET ${pagesBase}/${path} -> ${response.status}`);
      return response.text();
    };
    const [skilldataText, descText, skilldataSchema, descSchema, bundle] = await Promise.all([
      fetchText("json/skilldata.json"),
      fetchText("json/skilldesc-en.json"),
      fetchText("schemas/skilldata.schema.json"),
      fetchText("schemas/skilldesc.schema.json"),
      fetchText("js/gw-skilldata-node.cjs"),
    ]);
    const skilldata = JSON.parse(skilldataText);
    const desc = JSON.parse(descText);

    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    validateAgainstSchema(ajv, "skilldata.json", skilldataSchema, skilldata);
    validateAgainstSchema(ajv, "skilldesc-en.json", descSchema, desc);

    // Constants (PROFESSIONS/ATTRIBUTES/CAMPAIGNS/SKILLTYPES) must come from
    // the same channel as the data (SKILLTYPES evolves): the Pages-served
    // node bundle is built by their CI from the same commit. Executing it is
    // the same trust level as our npm dependency on the same author.
    const { tmpdir } = await import("node:os");
    const bundlePath = join(tmpdir(), `gw-skilldata-${Date.now()}.cjs`);
    writeFileSync(bundlePath, bundle);
    const require = createRequire(import.meta.url);
    const constants = require(bundlePath) as Record<string, unknown>;

    // Provenance bound to the actual bytes we fetched (GW1-06): a post-hoc
    // `ls-remote` names a commit that may differ from what produced these five
    // files (a Pages redeploy between requests could even mix versions). We
    // record a content hash of each downloaded artifact so an import is
    // reproducible and tamper-evident, and keep the remote HEAD only as a
    // secondary hint. Not a signed manifest (that needs upstream support), but
    // it ties provenance to data instead of to a racy side channel.
    const { createHash } = await import("node:crypto");
    const digest = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
    const contentHashes = {
      skilldata: digest(skilldataText),
      skilldesc: digest(descText),
      skilldataSchema: digest(skilldataSchema),
      descSchema: digest(descSchema),
      bundle: digest(bundle),
    };

    let version = `pages:${new Date().toISOString().slice(0, 10)}`;
    try {
      const head = execSync(
        "git ls-remote https://github.com/build-wars/gw-skilldata.git refs/heads/main",
      )
        .toString()
        .slice(0, 12);
      version = `pages@${head}`;
    } catch {
      /* provenance falls back to the fetch date */
    }
    version = `${version} (sha256 skilldata:${contentHashes.skilldata} desc:${contentHashes.skilldesc} skilldataSchema:${contentHashes.skilldataSchema} descSchema:${contentHashes.descSchema} bundle:${contentHashes.bundle})`;
    return {
      ATTRIBUTES: constants.ATTRIBUTES,
      CAMPAIGNS: constants.CAMPAIGNS,
      PROFESSIONS: constants.PROFESSIONS,
      SKILLTYPES: constants.SKILLTYPES,
      skilldata: skilldata.skilldata,
      skilldesc: desc.skilldesc,
      version,
    } as Upstream;
  }

  if (cloneRoot) {
    const constants = await import(pathToFileURL(join(cloneRoot, "es6", "constants.js")).href);
    const skilldata = JSON.parse(
      readFileSync(join(cloneRoot, "data", "json-full", "skilldata.json"), "utf8"),
    );
    const desc = JSON.parse(
      readFileSync(join(cloneRoot, "data", "json-full", "skilldesc-en.json"), "utf8"),
    );

    // Validate the upstream files against the schemas they ship.
    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    validateAgainstSchema(
      ajv,
      "skilldata.json",
      readFileSync(join(cloneRoot, "data", "schemas", "skilldata.schema.json"), "utf8"),
      skilldata,
    );
    validateAgainstSchema(
      ajv,
      "skilldesc-en.json",
      readFileSync(join(cloneRoot, "data", "schemas", "skilldesc.schema.json"), "utf8"),
      desc,
    );

    const version = `git:${JSON.parse(readFileSync(join(cloneRoot, "package.json"), "utf8")).version}`;
    return {
      ...constants,
      skilldata: skilldata.skilldata,
      skilldesc: desc.skilldesc,
      version,
    } as Upstream;
  }
  // Provenance for THIS path comes from a different, arguably stronger
  // mechanism than the Pages path's content hashing (GW1-06): `pnpm install
  // --frozen-lockfile` already verified this exact resolved version against
  // the lockfile's SHA-512 integrity before this code ever ran. Hashing the
  // already-lockfile-verified bytes again here would be redundant, not more
  // secure — so this path intentionally has no ad-hoc digest of its own.
  const module_ = await import("@buildwars/gw-skilldata");
  const require = createRequire(import.meta.url);
  const pkg = JSON.parse(
    readFileSync(require.resolve("@buildwars/gw-skilldata/package.json"), "utf8"),
  );
  const english = new module_.SkillLangEnglish() as unknown as {
    skilldata: Record<string, unknown>;
    skilldesc: Record<string, unknown>;
  };
  return {
    ATTRIBUTES: module_.ATTRIBUTES,
    CAMPAIGNS: module_.CAMPAIGNS,
    PROFESSIONS: module_.PROFESSIONS,
    SKILLTYPES: module_.SKILLTYPES,
    skilldata: english.skilldata,
    skilldesc: english.skilldesc,
    version: `npm:${pkg.version}`,
  } as Upstream;
}
