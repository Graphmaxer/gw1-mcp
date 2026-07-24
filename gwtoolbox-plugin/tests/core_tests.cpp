// Unit tests for the pure core of the AccountExport plugin. No framework:
// plain asserts, compiled and run on the fast Linux CI with -Wall -Wextra
// -Werror (the Windows plugin workflow keeps proving MSVC integration).
#include "../AccountExport/AccountExportCore.h"

// Every check below is an assert(), which NDEBUG compiles out — the suite would
// then exit 0 having verified nothing. Fail the build instead of going silent.
#ifdef NDEBUG
#error "core_tests.cpp relies on assert(); do not compile with NDEBUG"
#endif

#include <cassert>
#include <fstream>
#include <sstream>
#include <cstdint>
#include <string>
#include <vector>

using account_export::AppendSkillBitfield;
using account_export::HeroName;
using account_export::JsonEscapeInto;

namespace {

std::string escaped(const std::string& in)
{
    std::string out;
    JsonEscapeInto(out, in);
    return out;
}

// Minimal array-like standing in for GW::Array<uint32_t>.
struct FakeBitfield {
    std::vector<uint32_t> words;
    bool is_valid = true;
    bool valid() const { return is_valid; }
    uint32_t size() const { return static_cast<uint32_t>(words.size()); }
    uint32_t operator[](const uint32_t i) const { return words[i]; }
};

// Strips whitespace outside of strings (escape-aware) so the golden file can
// live pretty-printed (readable, diffable, formatter-friendly) while the
// builder emits compact JSON. The contract is the content, not the layout.
std::string CompactJson(const std::string& pretty)
{
    std::string out;
    out.reserve(pretty.size());
    bool in_string = false;
    bool escaped = false;
    for (const char c : pretty) {
        if (in_string) {
            out += c;
            if (escaped) {
                escaped = false;
            }
            else if (c == '\\') {
                escaped = true;
            }
            else if (c == '"') {
                in_string = false;
            }
        }
        else if (c == '"') {
            out += c;
            in_string = true;
        }
        else if (c != ' ' && c != '\n' && c != '\r' && c != '\t') {
            out += c;
        }
    }
    return out;
}

std::string bits(const FakeBitfield& field)
{
    std::string out;
    AppendSkillBitfield(out, field);
    return out;
}

} // namespace

int main()
{
    // ── JSON escaping: the failure mode is a corrupt export ──
    assert(escaped("plain") == "plain");
    assert(escaped("say \"hi\"") == "say \\\"hi\\\"");
    assert(escaped("back\\slash") == "back\\\\slash");
    assert(escaped("line\nbreak\ttab\rret") == "line\\nbreak\\ttab\\rret");
    assert(escaped(std::string(1, '\x01')) == "\\u0001");
    assert(escaped(std::string(1, '\x1f')) == "\\u001f");
    // UTF-8 multibyte passes through untouched (already encoded upstream);
    // bytes >= 0x80 are signed-char negative — must NOT hit the control branch.
    assert(escaped("Mélonni 😀") == "Mélonni 😀");

    // ── Hero table: bounds and canonical names ──
    assert(std::string(HeroName(0)) == "None");
    assert(std::string(HeroName(1)) == "Norgu");
    assert(std::string(HeroName(27)) == "Ogden Stonehealer");
    assert(std::string(HeroName(35)) == "Merc8");
    // ids 36-39 exported "Unknown" while the table was hand-maintained —
    // the generated table knows them (the drift that proved the principle).
    assert(std::string(HeroName(36)) == "Miku");
    assert(std::string(HeroName(39)) == "Ghost of Althea");
    constexpr auto table_size = static_cast<uint32_t>(std::size(account_export::kHeroNames));
    static_assert(std::size(account_export::kHeroNames) == 40);
    assert(std::string(HeroName(table_size)) == "Unknown");
    assert(std::string(HeroName(9999)) == "Unknown");

    // ── Skill bitfield: bit index == template skill id ──
    assert(bits({.words = {}}) == "[]");
    assert(bits({.words = {}, .is_valid = false}) == "[]");
    assert(bits({.words = {0b1}}) == "[0]");
    assert(bits({.words = {0b1010}}) == "[1,3]");
    // zero words are skipped without breaking the id offset of later words
    assert(bits({.words = {0, 0, 0b1}}) == "[64]");
    // word boundary: bit 31 of word 0, bit 0 of word 1
    assert(bits({.words = {0x8000'0000u, 0b1}}) == "[31,32]");
    // all bits of a word
    {
        const std::string all = bits({.words = {0xFFFF'FFFFu}});
        assert(all.front() == '[' && all.back() == ']');
        assert(all == "[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]");
    }

    // ── Full-document contract (snapshot pattern) ──
    // The golden file is SHARED with the consumer side: the gw-mcp test suite
    // parses the same fixture and feeds it to validate_build. If the builder
    // output drifts, this diff fails; if the consumer expectation drifts,
    // the TS test fails. Regenerate the golden only on a DELIBERATE format
    // change (bump "version" when you do).
    {
        account_export::AccountSnapshot s;
        s.character_name_utf8 = "Graph \"Maxette\" Test"; // exercises escaping
        s.primary_profession_id = 10;
        s.secondary_profession_id = 3;
        s.level = 20;
        s.map_id = 431;
        s.heroes = {
            {27, 20, 3, 0}, // Ogden Stonehealer
            {26, 20, 6, 0}, // Vekk
            {11, 20, 9, 0}, // General Morgahn
        };
        s.unlocked_account_skills = {0, 0, 0b10, 0x80000000u};
        s.learned_character_skills = {0b1000000000000000000000000000000, 0, 0b101};

        std::ifstream golden_file("gwtoolbox-plugin/tests/sample-export.json");
        assert(golden_file.good() && "run from the repo root");
        std::stringstream golden;
        golden << golden_file.rdbuf();
        // sanity-check the canonicalizer itself on the tricky escape case
        assert(CompactJson("{ \"a b\": \"say \\\"hi\\\" \" }") == "{\"a b\":\"say \\\"hi\\\" \"}");
        assert(account_export::BuildAccountJson(s) == CompactJson(golden.str()));
    }

    return 0;
}
