import { describe, expect, it } from "vitest";
import { resolveSourceArg } from "../scripts/import.js";

describe("resolveSourceArg (regression: pnpm '--' passthrough)", () => {
  // `pnpm run import:data -- <url>` forwards a literal "--" into argv ahead
  // of the URL. This silently defeated the Pages import on every single run
  // since the workflow was written (see the CI log: it tried to import
  // ".../--/es6/constants.js"), while the npm fallback made it look like a
  // deliberate, working design instead of a bug.
  it("strips a literal '--' and returns the real argument", () => {
    expect(resolveSourceArg(["--", "https://build-wars.github.io/gw-skilldata"])).toBe(
      "https://build-wars.github.io/gw-skilldata",
    );
  });
  it("passes a URL through untouched when there is no '--'", () => {
    expect(resolveSourceArg(["https://build-wars.github.io/gw-skilldata"])).toBe(
      "https://build-wars.github.io/gw-skilldata",
    );
  });
  it("returns undefined (npm default) when no argument is given", () => {
    expect(resolveSourceArg([])).toBeUndefined();
  });
});
