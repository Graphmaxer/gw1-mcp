import { describe, expect, it, vi } from "vitest";

/**
 * The French table and skills.json CAN disagree, by design.
 *
 * Only the Pages and clone channels serve French, so a weekly run that falls back
 * to npm refreshes skills.json and leaves the French table alone (debt #11). The
 * two directions of that drift are handled in different places and only one of
 * them is reachable from the committed data, which is why this file exists: the
 * guard for the other direction was the single uncovered line in the feature.
 *
 * Module-level mock plus resetModules, because the indexes are built from the
 * imported JSON at first use — there is no seam to inject through, and inventing
 * one would widen gw-data's public API for a test's convenience.
 */
describe("a French table that disagrees with skills.json", () => {
  it("skips a French name for an id no skill has, instead of indexing undefined", async () => {
    vi.resetModules();
    vi.doMock("../data/skill-names-fr.json", () => ({
      default: {
        // A real skill, to prove the mock is wired in and the rest still works.
        "1": "Sceau de guérison",
        // An id no skill has: what a French table refreshed ahead of skills.json
        // looks like (upstream is 31 skills ahead as this lands).
        "999999": "Compétence Fantôme",
      },
    }));
    const { getSkillByName, suggestSkillNames } = await import("../src/repository.js");

    expect(getSkillByName("Sceau de guérison")?.name).toBe("Healing Signet");
    // Non-vacuity: the mock must really have REPLACED the committed table, or the
    // phantom assertions below would pass for the trivial reason that no such name
    // exists anywhere. "Mantra de la terre" is in the real table and not the mock.
    expect(getSkillByName("Mantra de la terre")).toBeUndefined();
    // The phantom entry must not resolve, and must not throw on the way.
    expect(getSkillByName("Compétence Fantôme")).toBeUndefined();
    // Nor may it reach the suggester as an undefined skill, which would throw on
    // `.name` — the failure the guard prevents, and the reason it is not dead code.
    expect(() => suggestSkillNames("Competence Fantome")).not.toThrow();
    expect(suggestSkillNames("Compétence Fantôme")).not.toContain(undefined);

    vi.doUnmock("../data/skill-names-fr.json");
    vi.resetModules();
  });
});
