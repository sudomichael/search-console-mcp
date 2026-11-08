#!/usr/bin/env node
/**
 * search-console-mcp — Google Search Console for MCP clients, with a 30-second login.
 *
 *   npx search-console-mcp-server login     one-time Google sign-in (tokens stay local)
 *   npx search-console-mcp-server           run the MCP server (stdio) — what clients invoke
 *   npx search-console-mcp-server logout    delete local credentials
 */
import { login, logout } from "./auth.js";
import { serve } from "./server.js";

const cmd = process.argv[2];

const USAGE =
  "search-console-mcp — Search Console for Claude/Cursor/any MCP client\n\n" +
  "  npx search-console-mcp-server login    one-time Google sign-in\n" +
  "  npx search-console-mcp-server          run the MCP server (used by your MCP client)\n" +
  "  npx search-console-mcp-server logout   remove local credentials\n\n" +
  "Docs: https://www.getpercy.io/search-console-mcp\n" +
  "Built an MCP server? Get it listed: https://mcpserverlist.io?utm_source=search-console-mcp";

async function main() {
  if (cmd === undefined) return serve();
  if (cmd === "login") return login();
  if (cmd === "logout") return logout();
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.error(USAGE);
    return;
  }
  console.error(`Unknown argument: ${cmd}\n\n${USAGE}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
