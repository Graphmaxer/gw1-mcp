# Upstream issue to file against build-wars/gw-templates

**Title: `SkillTemplate.encode()` truncates a lone high skill id (getPadSize increments at most once per element)**

`getPadSize($nums, $min_pad)` increments the pad size at most once per element:

```js
for (let num of $nums) {
  if (PHPJS.intval(num) >= Math.pow(2, $min_pad)) {
    $min_pad++;
  }
}
```

If a single skill id needs more than one increment above the minimum (e.g. one
id >= 2048 among otherwise small ids), the resulting width is insufficient and
`decbin_pad` silently truncates the id, corrupting the whole skill section.

**Reproduction (JS):**

```js
import { SkillTemplate } from "@buildwars/gw-templates";
const t = new SkillTemplate();
const skills = [188, 3142, 243, 0, 949, 1321, 882, 443]; // 3142 needs 12 bits
const code = t.encode(3, 2, { 16: 11 }, skills);
console.log(t.decode(code).skills);
// -> [188, 1094, ...corrupted]   (1094 === 3142 - 2048, top bit lost)
```

Any build whose only high id is an EotN/Reforged-era skill is affected
(Cure Hex 2112, Ebon Vanguard Assassin Support 2235, Vow of Revolution 3430…).
The PHP implementation shares the same `getPadSize` logic.

**Suggested fix:** compute the width from the maximum value instead of
incrementing per element, e.g. `Math.max($min_pad, maxValue.toString(2).length)`.

Found via differential testing against an independent codec implementation
(gw1-mcp); a sentinel test tracking this bug lives in
`packages/gw-template/test/differential.test.ts`. Note for gw1builds.com:
this library is a production dependency there, so encoded bars containing a
lone high skill id may be corrupted.
