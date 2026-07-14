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
    std::string out(static_cast<size_t>(needed) - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, wstr, -1, out.data(), needed, nullptr, nullptr);
    return out;
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

    std::string json;
    json.reserve(16 * 1024);
    json += "{\"type\":\"gw1-mcp-account-export\",\"version\":1";

    // --- character ----------------------------------------------------------
    json += ",\"character\":{\"name\":\"";
    account_export::JsonEscapeInto(json, WStringToUtf8(character->player_name));
    json += "\",\"primaryProfessionId\":";
    json += std::to_string(static_cast<uint32_t>(player->primary));
    json += ",\"secondaryProfessionId\":";
    json += std::to_string(static_cast<uint32_t>(player->secondary));
    json += ",\"level\":";
    json += std::to_string(player->level);
    json += ",\"mapId\":";
    json += std::to_string(static_cast<uint32_t>(GW::Map::GetMapID()));
    json += "}";

    // --- heroes -------------------------------------------------------------
    json += ",\"heroes\":[";
    uint32_t hero_count = 0;
    const auto& heroes = world->hero_info;
    if (heroes.valid()) {
        for (uint32_t i = 0; i < heroes.size(); i++) {
            const GW::HeroInfo& hero = heroes[i];
            if (hero_count > 0) {
                json += ',';
            }
            json += "{\"id\":";
            json += std::to_string(static_cast<uint32_t>(hero.hero_id));
            json += ",\"name\":\"";
            account_export::JsonEscapeInto(json, account_export::HeroName(hero.hero_id));
            json += "\",\"level\":";
            json += std::to_string(hero.level);
            json += ",\"primaryProfessionId\":";
            json += std::to_string(static_cast<uint32_t>(hero.primary));
            json += ",\"secondaryProfessionId\":";
            json += std::to_string(static_cast<uint32_t>(hero.secondary));
            json += "}";
            hero_count++;
        }
    }
    json += "]";

    // --- skills -------------------------------------------------------------
    // Account-unlocked skills: what heroes can equip (and tomes can teach).
    json += ",\"unlockedAccountSkills\":";
    account_export::AppendSkillBitfield(json, account->unlocked_account_skills);

    // Character-learned skills: what this character can put on their own bar.
    json += ",\"learnedCharacterSkills\":";
    account_export::AppendSkillBitfield(json, world->unlocked_character_skills);

    json += "}";

    ImGui::SetClipboardText(json.c_str());

    wchar_t message[128];
    swprintf(message, _countof(message),
             L"[AccountExport] Account export copied to clipboard (%u heroes). Paste it to your assistant.",
             hero_count);
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
