#pragma once

#include <ToolboxPlugin.h>

// Account export plugin for gw1-mcp.
// Adds /exportaccount: copies a JSON snapshot of the
// account state relevant to build-making (character professions, unlocked
// heroes, account-unlocked skills, character-learned skills) to the
// clipboard, ready to be pasted into an LLM conversation backed by the
// gw1-mcp server. Read-only: no game state is ever modified.
class AccountExport : public ToolboxPlugin {
public:
    AccountExport() = default;
    ~AccountExport() override = default;

    const char* Name() const override { return "GW1 Account Export"; }

    void Initialize(ImGuiContext* ctx, ImGuiAllocFns allocator_fns, HMODULE toolbox_dll) override;
    void SignalTerminate() override;
    bool CanTerminate() override { return true; }
};
