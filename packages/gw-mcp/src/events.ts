import type { ToolName } from "./tool-names.js";

/**
 * Turn a tool result into a domain event. Reads the RESULT rather than the
 * request on purpose: an entity name taken from structuredContent has been
 * resolved against our dataset, whereas the argument is whatever the caller
 * typed. Codes likewise come from our own enums.
 *
 * Deliberately NOT captured: the template code produced by encode_template. It
 * is derived from caller input and carries no aggregate meaning.
 */
export function deriveEvent(
  tool: ToolName,
  args: unknown,
  result: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { text?: string }[];
  },
): ToolCallEvent {
  const ok = result.isError !== true;
  const structured = result.structuredContent;

  // Error code: jsonError puts it in the JSON body, since a failed call carries
  // no structuredContent.
  let code: string | undefined;
  if (!ok) {
    try {
      const body = JSON.parse(result.content?.[0]?.text ?? "{}") as {
        error?: { code?: string };
      };
      code = typeof body.error?.code === "string" ? body.error.code : undefined;
    } catch {
      code = undefined;
    }
  } else if (Array.isArray(structured?.["errors"])) {
    // A requested report (validate_build, encode_template rule violations) is a
    // successful call whose content says the build is illegal. The FIRST code is
    // the interesting one: it is what a caller would fix first.
    const first = (structured["errors"] as { code?: unknown }[])[0]?.code;
    code = typeof first === "string" ? first : undefined;
  }

  // Canonical entity, only where a single one was resolved.
  const resolvesEntity = tool === "get_skill" || tool === "get_hero";
  const entity =
    ok && resolvesEntity && typeof structured?.["name"] === "string"
      ? (structured["name"] as string)
      : undefined;
  const profession =
    entity !== undefined && typeof structured?.["profession"] === "string"
      ? (structured["profession"] as string)
      : undefined;

  // Context flags: typed booleans from the schema, never free text.
  const flags: string[] = [];
  if (args && typeof args === "object") {
    const a = args as Record<string, unknown>;
    if (a["forHero"] === true) flags.push("forHero");
    if (a["forPvp"] === true) flags.push("forPvp");
    if (Array.isArray(a["unlockedSkillIds"])) flags.push("unlockedSkillIds");
  }

  return {
    tool,
    ok,
    ...(code !== undefined && { code }),
    ...(entity !== undefined && { entity }),
    ...(profession !== undefined && { profession }),
    ...(flags.length > 0 && { flags }),
  };
}

export interface ToolCallEvent {
  /** Which tool ran. Always one of TOOL_NAMES. */
  readonly tool: ToolName;
  /** false when the call itself failed (MCP isError), not when a report says invalid. */
  readonly ok: boolean;
  /** Our own error or validation code, e.g. NOT_FOUND, MULTIPLE_ELITES. */
  readonly code?: string;
  /** Canonical entity name resolved from our dataset, e.g. "Mystic Regeneration". */
  readonly entity?: string;
  /**
   * Profession the resolved entity belongs to, e.g. "Monk", or "none" for common
   * and PvE-only skills. Present whenever `entity` is, since both get_skill and
   * get_hero resolve one — which makes a two-level profession/entity reading
   * possible without a second lookup.
   */
  readonly profession?: string;
  /** Context flags the caller actually set, e.g. ["forHero"]. Booleans, not text. */
  readonly flags?: readonly string[];
}

export interface CreateServerOptions {
  /** Optional observer. Must never throw; failures are swallowed by design. */
  readonly onToolCall?: (event: ToolCallEvent) => void;
}
