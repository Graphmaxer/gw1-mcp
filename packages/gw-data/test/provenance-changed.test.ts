import { describe, expect, it } from "vitest";
import { provenanceKindChanged, provenanceSourceKind } from "../scripts/provenance-changed.ts";

/**
 * These lock the rule the weekly workflow leans on: a provenance-only diff is
 * committed when the IMPORT CHANNEL changed and reverted otherwise. Get it too
 * loose and the weekly job opens a date-bump PR every Monday; too tight and the
 * repository goes on claiming `npm:2.0.0` after the Pages path recovers, which
 * is the state run #19 left it in.
 */

const meta = (sourceVersion: string) =>
  JSON.stringify({
    skills: { source: "https://github.com/build-wars/gw-skilldata", sourceVersion },
    heroes: { source: "GWCA HeroID enum" },
  });

// The two real strings this has to separate, copied from actual runs rather
// than invented: run #18's fallback and run #19's Pages import.
const NPM = "npm:2.0.0";
const PAGES =
  "pages@e32dbdc4e0ec (sha256 skilldata:2f4bcec2bdec14fd desc:7af3a68fbf7dabc8 skilldataSchema:0e1cb51189d0dd8c descSchema:5779171e35e6f56c bundle:08ca993c6bc57aa2)";
// The shape `git ls-remote` failure produces — it must classify as `pages`,
// not as a third kind, or a network blip during a Pages run would look like a
// channel change and open a PR.
const PAGES_DATED = "pages:2026-08-17 (sha256 skilldata:2f4bcec2bdec14fd)";

describe("provenanceSourceKind", () => {
  it("names the channel, not the version", () => {
    expect(provenanceSourceKind(NPM)).toBe("npm");
    expect(provenanceSourceKind(PAGES)).toBe("pages");
    expect(provenanceSourceKind(PAGES_DATED)).toBe("pages");
  });

  it("does not invent a kind for a missing or non-string value", () => {
    expect(provenanceSourceKind(undefined)).toBe("unknown");
    expect(provenanceSourceKind(42)).toBe("unknown");
    expect(provenanceSourceKind("")).toBe("unknown");
  });
});

describe("provenanceKindChanged", () => {
  it("fires when the fallback recovers to Pages — the run #19 case", () => {
    expect(provenanceKindChanged(meta(NPM), meta(PAGES))).toBe(true);
  });

  it("fires when Pages degrades to the npm fallback", () => {
    expect(provenanceKindChanged(meta(PAGES), meta(NPM))).toBe(true);
  });

  it("stays quiet for a same-channel date, sha or version bump", () => {
    // The weekly no-op: identical channel, new date and hashes every run.
    expect(
      provenanceKindChanged(
        meta(PAGES),
        meta("pages@aaaaaaaaaaaa (sha256 skilldata:1111111111111111)"),
      ),
    ).toBe(false);
    expect(provenanceKindChanged(meta(PAGES), meta(PAGES_DATED))).toBe(false);
    expect(provenanceKindChanged(meta("npm:2.0.0"), meta("npm:2.1.0"))).toBe(false);
  });

  it("treats absent or unreadable history as a change, so a record gets written", () => {
    expect(provenanceKindChanged(undefined, meta(PAGES))).toBe(true);
    expect(provenanceKindChanged("{ not json", meta(PAGES))).toBe(true);
    expect(provenanceKindChanged(JSON.stringify({}), meta(PAGES))).toBe(true);
  });

  it("reads the pipeline it is asked about, not whichever comes first", () => {
    // heroes and skills are independent pipelines writing the same file.
    const before = JSON.stringify({
      skills: { sourceVersion: NPM },
      heroes: { sourceVersion: "gwca@1" },
    });
    const after = JSON.stringify({
      skills: { sourceVersion: NPM },
      heroes: { sourceVersion: "vendored@2" },
    });
    expect(provenanceKindChanged(before, after, "skills")).toBe(false);
    expect(provenanceKindChanged(before, after, "heroes")).toBe(true);
  });
});

describe("the committed _meta.json is a shape this can read", () => {
  it("classifies the real file rather than only synthetic ones", async () => {
    // Non-vacuity: if the file's shape drifts, the workflow's decision silently
    // becomes "unknown vs unknown" = no change, and provenance freezes again.
    const { readFileSync } = await import("node:fs");
    const committed = readFileSync(new URL("../data/_meta.json", import.meta.url), "utf8");
    const kind = provenanceSourceKind(
      (JSON.parse(committed) as { skills: { sourceVersion: string } }).skills.sourceVersion,
    );
    expect(["npm", "pages"]).toContain(kind);
  });
});
