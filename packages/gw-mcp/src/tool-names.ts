/**
 * THE single source of truth for tool names. Everything derives from here:
 * server.ts registrations are compiler-checked against this union (each
 * literal carries `satisfies ToolName`), and the worker's analytics label
 * whitelist imports this array directly — nothing to sync, nothing to drift.
 */
export const TOOL_NAMES = [
  "get_skill",
  "search_skills",
  "decode_template",
  "encode_template",
  "validate_build",
  "get_hero",
  "list_heroes",
  "decode_pawned_team",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
