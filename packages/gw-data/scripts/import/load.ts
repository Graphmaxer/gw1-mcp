import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { validateAgainstSchema } from "./upstream-schema.ts";

export interface Upstream {
  ATTRIBUTES: unknown;
  CAMPAIGNS: unknown;
  PROFESSIONS: unknown;
  SKILLTYPES: unknown;
  skilldata: Record<string, unknown>;
  skilldesc: Record<string, unknown>;
  /**
   * French names, when the channel serves them.
   *
   * OPTIONAL on purpose: npm 2.0.0, the latest published version and the local-dev
   * default, exports SkillLangEnglish and SkillLangGerman only. French landed on the
   * upstream's main branch after that release, so it reaches us through Pages and
   * through a clone but not through the package. An importer that REQUIRED it would
   * break local dev and, worse, the weekly job's npm fallback.
   */
  skilldescFr?: Record<string, unknown>;
  version: string;
}

/**
 * Do the two data files describe the SAME snapshot?
 *
 * The provenance comment below already knew the risk — "a Pages redeploy between
 * requests could even mix versions" — and answered it by hashing what was
 * fetched, which makes an incoherent import reproducible rather than impossible.
 * On 2026-08-10 it happened: the weekly run imported a snapshot with 1484 skills
 * while upstream serves 1485 before and after, so the importer read a Pages
 * deploy mid-rebuild. Nothing noticed. The failing check was a README count
 * assertion three packages away, which named the wrong culprit and would have
 * fired identically on a legitimate change.
 *
 * A count-delta bound would NOT have caught it — the count moved by one, which is
 * exactly what a real balance patch looks like. Cross-file id equality does: the
 * two files are generated together and always agree (verified against upstream,
 * 1486 ids each including the id-0 sentinel), so any disagreement means we are
 * looking at two different builds.
 *
 * Hard failure, not a warning: a mixed snapshot must never reach the golden tests,
 * because the tests would mostly pass.
 */
export function assertCoherentSnapshot(
  skilldata: Record<string, unknown>,
  skilldesc: Record<string, unknown>,
): void {
  const dataIds = new Set(Object.keys(skilldata));
  const descIds = new Set(Object.keys(skilldesc));
  const onlyData = [...dataIds].filter((id) => !descIds.has(id));
  const onlyDesc = [...descIds].filter((id) => !dataIds.has(id));
  if (onlyData.length > 0 || onlyDesc.length > 0) {
    const show = (ids: string[]) => ids.slice(0, 10).join(", ") + (ids.length > 10 ? ", …" : "");
    throw new Error(
      `Incoherent upstream snapshot: skilldata has ${dataIds.size} ids, skilldesc has ${descIds.size}. ` +
        `${onlyData.length} only in skilldata (${show(onlyData)}); ` +
        `${onlyDesc.length} only in skilldesc (${show(onlyDesc)}). ` +
        `The two files are generated together, so this is two different builds — most likely a ` +
        `GitHub Pages deploy caught mid-rebuild. Re-run the import; if it persists, upstream is broken.`,
    );
  }
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
    /** Same as fetchText, but a 404 yields undefined instead of throwing. */
    const fetchOptionalText = async (path: string): Promise<string | undefined> => {
      const response = await fetch(`${pagesBase}/${path}`);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`GET ${pagesBase}/${path} -> ${response.status}`);
      return response.text();
    };
    const [skilldataText, descText, skilldataSchema, descSchema, bundle, descFrText] =
      await Promise.all([
        fetchText("json/skilldata.json"),
        fetchText("json/skilldesc-en.json"),
        fetchText("schemas/skilldata.schema.json"),
        fetchText("schemas/skilldesc.schema.json"),
        fetchText("js/gw-skilldata-node.cjs"),
        // Optional, and NOT linked from the upstream index page even though it is
        // served — so a 404 means "this channel has no French yet", not a broken
        // deploy. Absence never deletes the committed names (see import.ts), it only
        // leaves them unrefreshed, and the caller logs which of the two happened.
        fetchOptionalText("json/skilldesc-fr.json"),
      ]);
    const skilldata = JSON.parse(skilldataText);
    const desc = JSON.parse(descText);

    const { Ajv2020 } = await import("ajv/dist/2020.js");
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    validateAgainstSchema(ajv, "skilldata.json", skilldataSchema, skilldata);
    validateAgainstSchema(ajv, "skilldesc-en.json", descSchema, desc);
    // The schemas validate each file's SHAPE; this checks the two agree with each
    // other, which is the only thing that catches a half-deployed source.
    assertCoherentSnapshot(skilldata.skilldata, desc.skilldesc);

    // The French file is generated by the same upstream run and ships against the
    // same schema, so it gets the same two checks. Coherence matters MORE here than
    // it looks: the names are keyed by skill id, so a French file from a different
    // build would attach the right name to the wrong skill — the one failure mode in
    // this pipeline that produces a confidently wrong lookup rather than a missing one.
    let descFr: Record<string, unknown> | undefined;
    if (descFrText !== undefined) {
      const parsedFr = JSON.parse(descFrText);
      validateAgainstSchema(ajv, "skilldesc-fr.json", descSchema, parsedFr);
      assertCoherentSnapshot(skilldata.skilldata, parsedFr.skilldesc);
      descFr = parsedFr.skilldesc;
    }

    // Constants (PROFESSIONS/ATTRIBUTES/CAMPAIGNS/SKILLTYPES) must come from
    // the same channel as the data (SKILLTYPES evolves): the Pages-served
    // node bundle is built by their CI from the same commit. Executing it is
    // the same trust level as our npm dependency on the same author.
    // mkdtempSync, not a Date.now()-named file in a shared tmpdir: the old path
    // was predictable, so on a multi-user machine another process could win the
    // race and have OUR require() execute ITS file. Same character count, no
    // TOCTOU.
    const { tmpdir } = await import("node:os");
    const bundlePath = join(mkdtempSync(join(tmpdir(), "gw-skilldata-")), "bundle.cjs");
    writeFileSync(bundlePath, bundle);
    const require = createRequire(import.meta.url);
    // Normalised, not read directly: the bundle is whatever upstream has DEPLOYED,
    // so its shape is not pinned by our lockfile. 2.0.0 replaced the flat tables
    // with classes, and reading `.ATTRIBUTES` off a 2.x bundle yields four
    // `undefined`s that only fail three call frames later in a transform's `.map`.
    // That is exactly what broke the weekly Pages import (run #18, 2026-08-17):
    // the npm path was adapted for 2.x, this one was not, and the npm fallback
    // masked it as a warning.
    const constants = normaliseConstantTables(require(bundlePath) as Record<string, unknown>);

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
      // Sixth artifact, so GW1-06's "provenance is bound to the bytes we actually
      // fetched" covers the French channel too. Recorded as "absent" rather than
      // omitted when there is no French: a reader needs to tell "this run had no
      // French" from "this record predates French support".
      descFr: descFrText === undefined ? "absent" : digest(descFrText),
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
    version = `${version} (sha256 skilldata:${contentHashes.skilldata} desc:${contentHashes.skilldesc} descFr:${contentHashes.descFr} skilldataSchema:${contentHashes.skilldataSchema} descSchema:${contentHashes.descSchema} bundle:${contentHashes.bundle})`;
    return {
      ATTRIBUTES: constants.ATTRIBUTES,
      CAMPAIGNS: constants.CAMPAIGNS,
      PROFESSIONS: constants.PROFESSIONS,
      SKILLTYPES: constants.SKILLTYPES,
      skilldata: skilldata.skilldata,
      skilldesc: desc.skilldesc,
      ...(descFr === undefined ? {} : { skilldescFr: descFr }),
      version,
    } as Upstream;
  }

  if (cloneRoot) {
    // es6/index.js, NOT es6/constants.js: 2.0.0 deleted the latter outright, so this
    // path did not merely read undefined tables — it threw ERR_MODULE_NOT_FOUND. The
    // index is the stable entry point across both majors (1.x re-exports the flat
    // tables from it, 2.x exports the classes), and normaliseConstantTables takes
    // either.
    const constants = normaliseConstantTables(
      (await import(pathToFileURL(join(cloneRoot, "es6", "index.js")).href)) as Record<
        string,
        unknown
      >,
    );
    const skilldata = JSON.parse(
      readFileSync(join(cloneRoot, "data", "json-full", "skilldata.json"), "utf8"),
    );
    const desc = JSON.parse(
      readFileSync(join(cloneRoot, "data", "json-full", "skilldesc-en.json"), "utf8"),
    );
    // Optional for the same reason as the Pages path: a clone older than the commit
    // that added French has no such file, and that is not an error.
    const descFrPath = join(cloneRoot, "data", "json-full", "skilldesc-fr.json");
    const descFrClone = existsSync(descFrPath)
      ? JSON.parse(readFileSync(descFrPath, "utf8"))
      : undefined;

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
    assertCoherentSnapshot(skilldata.skilldata, desc.skilldesc);
    if (descFrClone !== undefined) {
      validateAgainstSchema(
        ajv,
        "skilldesc-fr.json",
        readFileSync(join(cloneRoot, "data", "schemas", "skilldesc.schema.json"), "utf8"),
        descFrClone,
      );
      assertCoherentSnapshot(skilldata.skilldata, descFrClone.skilldesc);
    }

    const version = `git:${JSON.parse(readFileSync(join(cloneRoot, "package.json"), "utf8")).version}`;
    return {
      // Named rather than spread, like the other two paths: the normaliser's four
      // keys are the contract here, and an upstream module gaining an export must
      // not silently widen what we return.
      ATTRIBUTES: constants.ATTRIBUTES,
      CAMPAIGNS: constants.CAMPAIGNS,
      PROFESSIONS: constants.PROFESSIONS,
      SKILLTYPES: constants.SKILLTYPES,
      skilldata: skilldata.skilldata,
      skilldesc: desc.skilldesc,
      ...(descFrClone === undefined ? {} : { skilldescFr: descFrClone.skilldesc }),
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
  // Looked up dynamically because 2.0.0 — the latest published version — does not
  // export it, while the upstream main branch already carries French. A future
  // release will, and this path picks it up with no code change. Asking
  // `typeof FrenchLang === "function"` is the honest question; hard-coding the
  // absence would need editing the day upstream publishes.
  const FrenchLang = (module_ as unknown as Record<string, unknown>)["SkillLangFrench"];
  const french =
    typeof FrenchLang === "function"
      ? (new (FrenchLang as new () => unknown)() as { skilldesc: Record<string, unknown> })
      : undefined;
  const { ATTRIBUTES, CAMPAIGNS, PROFESSIONS, SKILLTYPES } = normaliseConstantTables(
    module_ as unknown as Record<string, unknown>,
  );
  return {
    ATTRIBUTES,
    CAMPAIGNS,
    PROFESSIONS,
    SKILLTYPES,
    skilldata: english.skilldata,
    skilldesc: english.skilldesc,
    ...(french === undefined ? {} : { skilldescFr: french.skilldesc }),
    version: `npm:${pkg.version}`,
  } as Upstream;
}

/** One entry of a `{ de, en }` localised name table. */
type Localised = { de: string; en: string };

/**
 * Accept both upstream shapes for the four constant tables.
 *
 * @buildwars/gw-skilldata 2.0.0 replaced the flat `ATTRIBUTES`/`CAMPAIGNS`/
 * `PROFESSIONS`/`SKILLTYPES` tables with classes carrying id-keyed statics:
 *
 *   PROFESSIONS[id].name  -> Profession.NAME[id]
 *   PROFESSIONS[id].abbr  -> Profession.NAME_ABBR[id]
 *   CAMPAIGNS[id].name    -> Campaign.NAME[id]
 *   ATTRIBUTES[id].name   -> Attribute.NAME[id]
 *   ATTRIBUTES[id].prof   -> Attribute.PROFESSION[id]
 *   ATTRIBUTES[id].max    -> Attribute.MAX_VALUE[id]
 *   ATTRIBUTES[id].pri    -> derived by inverting Profession.PRIMARY_ATTRIBUTE
 *   SKILLTYPES[id].name   -> Type.NAME[id]
 *
 * Normalising here rather than in the transforms is deliberate: `loadUpstream` is
 * already the boundary that hides where the data came from, and the transforms are
 * covered by tests that compare against committed data. Adapting at the boundary
 * means the bump changes no transform and no output.
 *
 * Why accept BOTH: the Pages path fetches the upstream bundle from a URL, so which
 * shape arrives depends on what upstream has deployed, not on our lockfile. The two
 * paths can legitimately disagree for a while.
 *
 * The failure this replaces was not loud enough. Under 2.0.0 the old code returned
 * four `undefined` tables and `loadUpstream` SUCCEEDED; the import then died on
 * "Cannot read properties of undefined (reading 'map')", which says nothing about
 * the cause. Now an unrecognised shape is named as such.
 */
export function normaliseConstantTables(module_: Record<string, unknown>): {
  ATTRIBUTES: unknown;
  CAMPAIGNS: unknown;
  PROFESSIONS: unknown;
  SKILLTYPES: unknown;
} {
  if (module_["ATTRIBUTES"] !== undefined) {
    return {
      ATTRIBUTES: module_["ATTRIBUTES"],
      CAMPAIGNS: module_["CAMPAIGNS"],
      PROFESSIONS: module_["PROFESSIONS"],
      SKILLTYPES: module_["SKILLTYPES"],
    };
  }

  const Profession = module_["Profession"] as
    | {
        NAME: Record<string, Localised>;
        NAME_ABBR: Record<string, Localised>;
        PRIMARY_ATTRIBUTE: Record<string, number>;
      }
    | undefined;
  const Campaign = module_["Campaign"] as { NAME: Record<string, Localised> } | undefined;
  const Attribute = module_["Attribute"] as
    | {
        NAME: Record<string, Localised>;
        PROFESSION: Record<string, number>;
        MAX_VALUE: Record<string, number>;
      }
    | undefined;
  const Type = module_["Type"] as { NAME: Record<string, Localised> } | undefined;

  if (!Profession || !Campaign || !Attribute || !Type) {
    throw new Error(
      "upstream constant tables are in an unrecognised shape: expected either ATTRIBUTES/CAMPAIGNS/PROFESSIONS/SKILLTYPES (gw-skilldata 1.x) or Attribute/Campaign/Profession/Type (2.x). Neither was found — the upstream API changed again and scripts/import/load.ts needs a new branch.",
    );
  }

  // 2.x records profession -> its primary attribute; the transforms want the inverse
  // flag on each attribute. Profession 0 ("none") is EXCLUDED: it maps to attribute 101
  // ("No Attribute"), and including it marked that placeholder as a primary attribute —
  // caught by diffing the import output against the committed data, not by any test,
  // because no test asserts what No Attribute is.
  const primaryAttributeIds = new Set(
    Object.entries(Profession.PRIMARY_ATTRIBUTE)
      .filter(([professionId]) => Number(professionId) !== 0)
      .map(([, attributeId]) => attributeId),
  );

  const byId = <T>(table: Record<string, T>): [string, T][] =>
    Object.entries(table).sort(([a], [b]) => Number(a) - Number(b));

  return {
    // The transforms index CAMPAIGNS and PROFESSIONS positionally (`.map((c, id) =>`),
    // so these must be dense arrays ordered by id, not objects.
    CAMPAIGNS: byId(Campaign.NAME).map(([, name]) => ({ name })),
    PROFESSIONS: byId(Profession.NAME).map(([id, name]) => ({
      name,
      abbr: Profession.NAME_ABBR[id] ?? name,
    })),
    // ATTRIBUTES and SKILLTYPES are read with Object.entries, so id-keyed objects.
    ATTRIBUTES: Object.fromEntries(
      byId(Attribute.NAME).map(([id, name]) => [
        id,
        {
          name,
          prof: Attribute.PROFESSION[id],
          pri: primaryAttributeIds.has(Number(id)),
          max: Attribute.MAX_VALUE[id],
        },
      ]),
    ),
    SKILLTYPES: Object.fromEntries(byId(Type.NAME).map(([id, name]) => [id, { name }])),
  };
}
