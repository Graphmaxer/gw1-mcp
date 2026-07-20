#include "AccountExport.h"
#include "AccountExportCore.h"

#include <GWCA/Constants/Constants.h>
#include <GWCA/Context/AccountContext.h>
#include <GWCA/Context/CharContext.h>
#include <GWCA/Context/WorldContext.h>
#include <GWCA/GameContainers/Array.h>
#include <GWCA/GameEntities/Agent.h>
#include <GWCA/GameEntities/Hero.h>
#include <GWCA/Managers/AgentMgr.h>
#include <GWCA/Managers/ChatMgr.h>
#include <GWCA/Managers/MapMgr.h>
#include <GWCA/Utilities/Hook.h>

#include <imgui.h>

#include <string>
#include <vector>

namespace {

GW::HookEntry ChatCmd_HookEntry;

// Indexed by GW::Constants::HeroID (Constants.h). Names are the canonical
// English hero names as used by gw1-mcp / the wiki.
std::string WStringToUtf8(const wchar_t* wstr)
{
    if (!wstr || !*wstr) {
        return {};
    }
    const int needed = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, nullptr, 0, nullptr, nullptr);
    if (needed <= 1) {
        return {};
    }
    // Allocate the full size including the terminal NUL slot: WideCharToMultiByte
    // writes `needed` bytes (payload + NUL), so a `needed - 1` buffer wrote one
    // byte past size() — undefined behavior. Size to `needed`, then trim the NUL.
    // (audit GW1-03)
    std::string out(static_cast<size_t>(needed), '\0');
    const int written = WideCharToMultiByte(CP_UTF8, 0, wstr, -1, out.data(), needed, nullptr, nullptr);
    if (written <= 0) {
        return {};
    }
    out.resize(static_cast<size_t>(written) - 1);
    return out;
}

template <typename GwArray>
std::vector<uint32_t> CopyWords(const GwArray& bitfield)
{
    std::vector<uint32_t> words;
    if (bitfield.valid()) {
        words.reserve(bitfield.size());
        for (uint32_t i = 0; i < bitfield.size(); i++) {
            words.push_back(bitfield[i]);
        }
    }
    return words;
}

void ExportAccount(GW::HookStatus*, const wchar_t*, int, const LPWSTR*)
{
    const auto* world = GW::GetWorldContext();
    const auto* account = GW::GetAccountContext();
    const auto* character = GW::GetCharContext();
    const auto* player = GW::Agents::GetControlledCharacter();

    if (!world || !account || !character || !player) {
        GW::Chat::WriteChat(GW::Chat::Channel::CHANNEL_WARNING,
                            L"[AccountExport] Not in game yet - load a character first.", nullptr, true);
        return;
    }

    // Fill the plain snapshot from game memory; ALL document assembly lives
    // in the pure, unit-tested BuildAccountJson (AccountExportCore.h).
    account_export::AccountSnapshot snapshot;
    snapshot.character_name_utf8 = WStringToUtf8(character->player_name);
    snapshot.primary_profession_id = static_cast<uint32_t>(player->primary);
    snapshot.secondary_profession_id = static_cast<uint32_t>(player->secondary);
    snapshot.level = player->level;
    snapshot.map_id = static_cast<uint32_t>(GW::Map::GetMapID());

    const auto& heroes = world->hero_info;
    if (heroes.valid()) {
        snapshot.heroes.reserve(heroes.size());
        for (uint32_t i = 0; i < heroes.size(); i++) {
            const GW::HeroInfo& hero = heroes[i];
            snapshot.heroes.push_back({
                static_cast<uint32_t>(hero.hero_id),
                hero.level,
                static_cast<uint32_t>(hero.primary),
                static_cast<uint32_t>(hero.secondary),
            });
        }
    }
    snapshot.unlocked_account_skills = CopyWords(account->unlocked_account_skills);
    snapshot.learned_character_skills = CopyWords(world->unlocked_character_skills);

    const std::string json = account_export::BuildAccountJson(snapshot);
    ImGui::SetClipboardText(json.c_str());

    wchar_t message[128];
    swprintf(message, _countof(message),
             L"[AccountExport] Account export copied to clipboard (%zu heroes). Paste it to your assistant.",
             snapshot.heroes.size());
    GW::Chat::WriteChat(GW::Chat::Channel::CHANNEL_GLOBAL, message, nullptr, true);
}

} // namespace

DLLAPI ToolboxPlugin* ToolboxPluginInstance()
{
    static AccountExport instance;
    return &instance;
}

void AccountExport::Initialize(ImGuiContext* ctx, const ImGuiAllocFns allocator_fns, const HMODULE toolbox_dll)
{
    ToolboxPlugin::Initialize(ctx, allocator_fns, toolbox_dll);
    GW::Chat::CreateCommand(&ChatCmd_HookEntry, L"exportaccount", ExportAccount);
}

void AccountExport::SignalTerminate()
{
    ToolboxPlugin::SignalTerminate();
    GW::Chat::DeleteCommand(&ChatCmd_HookEntry);
}
