import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { identifierToName, parseHeroEnum } from "../scripts/check-heroes.js";
import heroes from "../data/heroes.json";

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
    expect(parsed.get(16)).toBe("M.O.X.");
    expect(parsed.get(38)).toBe("Devona");
    expect(parsed.get(39)).toBe("Ghost of Althea");
  });
  it("matches data/heroes.json exactly on this snapshot", () => {
    const local = new Map(heroes.map((h) => [h.id, h.name]));
    expect(new Map(parsed)).toEqual(local);
  });
  it("splits camel case and applies overrides", () => {
    expect(identifierToName("PyreFierceshot")).toBe("Pyre Fierceshot");
    expect(identifierToName("AcolyteJin")).toBe("Acolyte Jin");
  });
});
