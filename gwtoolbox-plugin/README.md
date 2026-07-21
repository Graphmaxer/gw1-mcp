# GWToolbox account export plugin

A minimal, read-only [GWToolboxpp](https://github.com/gwdevhub/GWToolboxpp)
plugin that adds one chat command:

```
/exportaccount
```

It copies a JSON snapshot of your account state to the clipboard:

```json
{
  "type": "gw1-mcp-account-export",
  "version": 1,
  "character": { "name": "…", "primaryProfessionId": 10, "secondaryProfessionId": 3, "level": 20, "mapId": 431 },
  "heroes": [{ "id": 6, "name": "Koss", "level": 20, "primaryProfessionId": 1, "secondaryProfessionId": 0 }],
  "unlockedAccountSkills": [1, 2, 5, …],
  "learnedCharacterSkills": [1, 2, …]
}
```

Paste it into your LLM conversation. The `validate_build` and `encode_template`
tools of gw1-mcp accept either list as `unlockedSkillIds`: use
`learnedCharacterSkills` for a build your own character will equip, or
`unlockedAccountSkills` for a hero's bar — proposed skills outside the list
you pass are flagged.

- `unlockedAccountSkills` = skills unlocked account-wide (what **heroes** can equip)
- `learnedCharacterSkills` = skills learned by the current character (what **your own bar** can hold)

## Data sources (GWCA)

| Field                       | Source                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Character name              | `GW::GetCharContext()->player_name`                                                 |
| Character professions/level | `GW::Agents::GetControlledCharacter()`                                              |
| Heroes                      | `GW::GetWorldContext()->hero_info`                                                  |
| Account-unlocked skills     | `GW::GetAccountContext()->unlocked_account_skills` (bitfield, bit index = skill id) |
| Character-learned skills    | `GW::GetWorldContext()->unlocked_character_skills` (bitfield)                       |

Everything is read-only; the plugin never writes game memory, sends packets,
or automates anything.

## Building

### Option A — GitHub Actions (nothing to install)

The repo ships `.github/workflows/build-gwtoolbox-plugin.yml`: it builds the
DLL on a GitHub-hosted Windows runner against a pinned GWToolboxpp commit
(`GWTOOLBOX_COMMIT` in the workflow — not the floating `master` branch, so a
supply-chain change upstream can't silently affect the build; see CLAUDE.md's
manual-pin registry for the bump procedure), mirroring their own CI (same
vcpkg pin, their `vcpkg` CMake preset). Go to
the **Actions** tab → _Build GWToolbox plugin_ → **Run workflow**, wait
(~20-30 min cold, faster once caches are warm), then download the
`AccountExport` artifact from the run — it contains the DLL (and PDB).
The workflow also re-runs automatically on any push touching
`gwtoolbox-plugin/`, so compile errors from `/W4 /WX` show up in the run log.

### Option B — locally on Windows

Requires Visual Studio 2022 (C++ workload) and CMake, like GWToolbox itself.

```powershell
git clone https://github.com/gwdevhub/GWToolboxpp.git
cd GWToolboxpp

# Drop this plugin in
Copy-Item -Recurse path\to\gw1-mcp\gwtoolbox-plugin\AccountExport plugins\AccountExport

# Declare it (one line at the end of cmake/gwtoolboxdll_plugins.cmake):
Add-Content cmake\gwtoolboxdll_plugins.cmake "add_tb_plugin(AccountExport)"

# Configure + build
cmake . --preset=vcpkg   # Win32 arch and vcpkg toolchain are baked into the preset
cmake --build build --config RelWithDebInfo --target AccountExport
```

The DLL lands in `bin\RelWithDebInfo\AccountExport.dll` (GWToolbox sets its
runtime output dir at the source root, not under build/). Copy it to your
GWToolbox plugins folder (`%LOCALAPPDATA%\GWToolboxpp\<computername>\plugins`),
then load it from Toolbox settings → Plugins.

Notes:

- GW1 is a 32-bit game: the `-A Win32` generator flag matters.
- Plugins are built with `/W4 /WX` (warnings are errors) — keep it clean.
- GWCA structures move with game updates; if a build breaks after a GW1 patch,
  re-pull GWToolboxpp and rebuild (with Option A, just re-run the workflow).
- GWToolboxpp also ships `clang` and `wine` CMake presets — building from
  Linux via wine/clang-cl looks supported upstream, but is untested here;
  the Actions route is the documented path.

## Why not upstream?

It might be! Once the plugin has proven itself, a PR adding a JSON export to
GWToolbox's own Completion window would give every Toolbox user the feature
without installing anything. This standalone plugin is the fastest path to a
working loop today.
