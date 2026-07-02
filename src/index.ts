#!/usr/bin/env node
/**
 * percy-gsc — Google Search Console for MCP clients, with a 30-second login.
 *
 *   npx percy-gsc login     one-time Google sign-in (tokens stay local)
 *   npx percy-gsc           run the MCP server (stdio) — what clients invoke
 *   npx percy-gsc logout    delete local credentials
 */
import { login, logout } from "./auth.js";
import { serve } from "./server.js";

const cmd = process.argv[2];

async function main() {
  if (cmd === "login") return login();
  if (cmd === "logout") return logout();
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.error(
      "percy-gsc — Search Console for Claude/Cursor/any MCP client\n\n" +
        "  npx percy-gsc login    one-time Google sign-in\n" +
        "  npx percy-gsc          run the MCP server (used by your MCP client)\n" +
        "  npx percy-gsc logout   remove local credentials\n\n" +
        "Docs: https://www.getpercy.io/gsc-mcp",
    );
    return;
  }
  return serve();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
