import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generateHeroes,
  identifierToName,
  parseHeroEnum,
  renderHeroNamesHeader,
} from "../scripts/import-heroes.js";
import type { HeroMeta } from "../scripts/import-heroes.js";
import heroes from "../data/heroes.json";
import overlay from "../data/heroes-overlay.json";

const header = readFileSync(
  new URL("./fixtures/gwca-heroid-2026-07-11.h", import.meta.url),
  "utf8",
);

const committedHeader = readFileSync(
  new URL("../../../gwtoolbox-plugin/AccountExport/hero-names.generated.h", import.meta.url),
  "utf8",
);

describe("C++ hero-names header stays in sync with heroes.json (GW1-07)", () => {
  it("the committed header equals a fresh render from heroes.json", () => {
    // The weekly workflow now carries this header in its patch; this test is
    // the second half of that guarantee — if heroes.json changes and the
    // header is not regenerated, CI fails instead of the DLL silently drifting.
    expect(committedHeader).toBe(renderHeroNamesHeader(heroes));
  });
});

describe("GWCA HeroID enum parsing", () => {
  const parsed = parseHeroEnum(header);
  it("extracts 31 playable heroes (mercs and sentinels excluded)", () => {
    expect(parsed.size).toBe(31);
    expect(parsed.has(0)).toBe(false); // NoHero
    expect(parsed.has(28)).toBe(false); // Merc1
  });
  it("assigns implicit ids correctly, including the Reforged additions", () => {
    expect(parsed.get(6)).toBe("Koss");
    expect(parsed.get(38)).toBe("Devona");
    expect(parsed.get(39)).toBe("GhostOfAlthea");
  });
  // Regression: upstream Constants.h is re-read weekly by update-data.yml, so a
  // comment added there must not be able to drop a hero or shift ids. Both
  // styles used to corrupt the map silently; block comments used to throw.
  it("ignores a // comment trailing an entry without swallowing the next hero", () => {
    const enumSrc = `enum HeroID : uint32_t {NoHero, Norgu, Goren, // the warrior\n Tahlkora, MasterOfWhispers, Count};`;
    expect([...parseHeroEnum(enumSrc)]).toEqual([
      [1, "Norgu"],
      [2, "Goren"],
      [3, "Tahlkora"],
      [4, "MasterOfWhispers"],
    ]);
  });
  it("ignores comments on their own line and keeps ids contiguous", () => {
    const enumSrc = `enum HeroID : uint32_t {NoHero, Norgu,\n// Reforged additions\nGoren, Tahlkora, Count};`;
    expect([...parseHeroEnum(enumSrc)]).toEqual([
      [1, "Norgu"],
      [2, "Goren"],
      [3, "Tahlkora"],
    ]);
  });
  it("ignores block comments instead of throwing on them", () => {
    const enumSrc = `enum HeroID : uint32_t {NoHero, Norgu, /* note */ Goren, Count};`;
    expect([...parseHeroEnum(enumSrc)]).toEqual([
      [1, "Norgu"],
      [2, "Goren"],
    ]);
  });
  it("still refuses explicit values rather than mis-numbering heroes", () => {
    const enumSrc = `enum HeroID : uint32_t {NoHero, Norgu = 4, Goren, Count};`;
    expect(() => parseHeroEnum(enumSrc)).toThrowError(/Update the parser/);
  });
  it("splits camel case and applies overrides", () => {
    expect(identifierToName("PyreFierceshot")).toBe("Pyre Fierceshot");
    expect(identifierToName("AcolyteJin")).toBe("Acolyte Jin");
    expect(identifierToName("MOX")).toBe("M.O.X.");
    expect(identifierToName("Ogden")).toBe("Ogden Stonehealer");
  });
});

describe("heroes.json generation", () => {
  it("enum snapshot + curated overlay reproduces data/heroes.json exactly", () => {
    expect(generateHeroes(header, overlay as Record<string, HeroMeta>)).toEqual(heroes);
  });
  it("fails loudly, listing identifiers, when the overlay lacks a hero", () => {
    const partial = { ...(overlay as Record<string, HeroMeta>) };
    delete partial["Devona"];
    delete partial["GhostOfAlthea"];
    expect(() => generateHeroes(header, partial)).toThrowError(/Devona, GhostOfAlthea/);
  });
});
