# search-console-mcp

**Talk to your Google Search Console from Claude, Cursor, or any MCP client — one sign-in, 30 seconds, no Google Cloud project.**

Every other Search Console MCP server makes you create a Google Cloud project, enable APIs, and wrangle service-account JSON. This one doesn't:

```bash
npx @getpercy/search-console-mcp login
```

Your browser opens, you sign in with Google, done. Tokens are minted by Google directly to your machine and stored **only** in `~/.search-console-mcp/` — nothing passes through anyone's servers. Read-only scope.

## Setup

**1. Sign in (one time):**

```bash
npx @getpercy/search-console-mcp login
```

**2. Add to your MCP client:**

Claude Code:

```bash
claude mcp add gsc -- npx -y @getpercy/search-console-mcp
```

Claude Desktop / Cursor / anything else (`mcpServers` config):

```json
{
  "mcpServers": {
    "gsc": { "command": "npx", "args": ["-y", "@getpercy/search-console-mcp"] }
  }
}
```

**3. Ask things:**

- *"Which of my pages lost the most clicks this month vs last?"*
- *"Show my queries sitting at position 8–15 with real impressions — what's closest to page 1?"*
- *"Is https://mysite.com/pricing indexed? If not, why?"*
- *"Compare mobile vs desktop CTR on my top 20 pages."*

## Tools

| Tool | What it does |
| --- | --- |
| `list_properties` | Your GSC properties (call first — gives exact `siteUrl` values) |
| `query_search_analytics` | Clicks / impressions / CTR / position by query, page, date, country, device — with filters |
| `inspect_url` | Google's index status for a URL: indexed or not, why, chosen canonical, last crawl |
| `list_sitemaps` | Submitted sitemaps with status |

## Privacy

- **Read-only** Google scope (`webmasters.readonly`).
- Tokens live in `~/.search-console-mcp/credentials.json` on your machine, `chmod 600`. `npx @getpercy/search-console-mcp logout` deletes them.
- No telemetry, no proxy — API calls go from your machine to Google, full stop.
- Prefer your own Google Cloud project? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` and it uses yours.

## Who made this

[Percy](https://www.getpercy.io) — an AI Head of SEO that watches your Search Console every week, builds a strategy, tells you exactly what to change, then re-checks the live page and measures the result. This MCP server is the "ask your data anything" half; Percy is the "someone works on it weekly" half.

MIT licensed. Issues and PRs welcome.
