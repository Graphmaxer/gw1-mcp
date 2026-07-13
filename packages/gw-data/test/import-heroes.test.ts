import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateHeroes, identifierToName, parseHeroEnum } from "../scripts/import-heroes.js";
import type { HeroMeta } from "../scripts/import-heroes.js";
import heroes from "../data/heroes.json";
import overlay from "../data/heroes-overlay.json";

const header = readFileSync(
  new URL("./fixtures/gwca-heroid-2026-07-11.h", import.meta.url),
  "utf8",
);

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
