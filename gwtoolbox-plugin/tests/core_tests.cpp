// Unit tests for the pure core of the AccountExport plugin. No framework:
// plain asserts, compiled and run on the fast Linux CI with -Wall -Wextra
// -Werror (the Windows plugin workflow keeps proving MSVC integration).
#include "../AccountExport/AccountExportCore.h"

#include <cassert>
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
    constexpr auto table_size = static_cast<uint32_t>(std::size(account_export::kHeroNames));
    assert(std::string(HeroName(table_size - 1)) == "Merc8");
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

    return 0;
}
