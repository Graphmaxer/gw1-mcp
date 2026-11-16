import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type CreateServerOptions, deriveEvent } from "./events.js";
import { registerResources } from "./resources.js";
import type { ToolName } from "./tool-names.js";
import { registerDecodePawnedTeamTool } from "./tools/decode-pawned-team.js";
import { registerDecodeTemplateTool } from "./tools/decode-template.js";
import { registerEncodeTemplateTool } from "./tools/encode-template.js";
import { registerGetSkillTool } from "./tools/get-skill.js";
import { registerHeroesTools } from "./tools/heroes.js";
import type { RegisterTool } from "./tools/register-tool.js";
import { registerSearchSkillsTool } from "./tools/search-skills.js";
import { registerValidateBuildTool } from "./tools/validate-build.js";

/**
 * Assembly only: this file names the server, wraps tool registration with the
 * observer, and lists what gets registered. Each tool lives in `tools/`, the
 * resources in `resources.ts`, and every schema at module scope in `schemas.ts`
 * — `createServer` runs on EVERY /mcp request, so nothing here may build one.
 */
export function createServer(options: CreateServerOptions = {}): McpServer {
  const server = new McpServer(
    {
      name: "gw1-mcp",
      version: "1.2.0", // x-release-please-version
    },
    {
      // Imported by clients (including the ChatGPT plugin scan) as server-level
      // guidance — the protocol-level counterpart of the bundled skill.
      instructions: [
        "Guild Wars 1 build compiler over live Reforged game data.",
        "Template codes MUST come from encode_template; never hand-write or guess a code, and verify every produced code with decode_template before presenting it.",
        "Trust this server's skill data over model memory: stats and descriptions follow the current balance patch.",
        "Error responses include closest-match suggestions for misspelled names — use them and retry.",
        "When exploring an attribute line with search_skills, do not filter by campaign.",
        "get_skill also accepts a skill's official French name; pass it through rather than translating it yourself, and use the English name it returns for every other tool.",
      ].join(" "),
    },
  );

  // Single choke point: every tool is registered through this, so instrumentation
  // cannot be forgotten on a new tool, and the 8 call sites keep their exact
  // types. The event is derived from the RESULT, so the entity name and codes come
  // from our own resolution rather than from what the caller asked for.
  const registerTool: RegisterTool = (name, config, cb) =>
    server.registerTool(name, config, (async (...args: unknown[]) => {
      const result = (await (cb as (...a: unknown[]) => unknown)(...args)) as {
        isError?: boolean;
        structuredContent?: Record<string, unknown>;
        content?: { text?: string }[];
      };
      try {
        options.onToolCall?.(deriveEvent(name as ToolName, args[0], result));
      } catch {
        // An observer must never break a tool call.
      }
      return result;
    }) as never);

  // Registration order is the order tools/list publishes, which the character
  // lock in conventions.test.ts and every directory listing depend on.
  registerGetSkillTool(registerTool);
  registerSearchSkillsTool(registerTool);
  registerDecodeTemplateTool(registerTool);
  registerDecodePawnedTeamTool(registerTool);
  registerEncodeTemplateTool(registerTool);
  registerValidateBuildTool(registerTool);
  registerHeroesTools(registerTool);

  registerResources(server);

  return server;
}
