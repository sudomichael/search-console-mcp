# search-console-mcp

**Talk to your Google Search Console from Claude, Cursor, or any MCP client — one sign-in, 30 seconds, no Google Cloud project.**

Every other Search Console MCP server makes you create a Google Cloud project, enable APIs, and wrangle service-account JSON. This one doesn't:

```bash
npx search-console-mcp-server login
```

Your browser opens, you sign in with Google, done. Tokens are minted by Google directly to your machine and stored **only** in `~/.search-console-mcp/` — nothing passes through anyone's servers. Read-only scope.

## Setup

**1. Sign in (one time):**

```bash
npx search-console-mcp-server login
```

**2. Add to your MCP client:**

Claude Code:

```bash
claude mcp add gsc -- npx -y search-console-mcp-server
```

Claude Desktop / Cursor / anything else (`mcpServers` config):

```json
{
  "mcpServers": {
    "gsc": { "command": "npx", "args": ["-y", "search-console-mcp-server"] }
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
| `query_search_analytics` | Clicks / impressions / CTR / position by query, page, date, country, device — filters, pagination, and every traffic source **including Google Discover** |
| `compare_periods` | Biggest movers, computed for you: this period vs the prior one, per-page or per-query deltas, sorted by change |
| `inspect_url` | Google's index status for a URL: indexed or not, why, chosen canonical, last crawl |
| `inspect_urls` | The same, batched — up to 10 URLs in one call for indexing audits |
| `list_sitemaps` | Submitted sitemaps with status |

Read-only by construction: the Google scope this tool requests (`webmasters.readonly`) **cannot** modify your properties, submit sitemaps, or change anything — not "disabled by default," impossible.

## Built-in analyses

Not just a connector — four ready-made analyses ship as MCP prompts (slash-commands in clients that support them):

| Prompt | What you get |
| --- | --- |
| `seo_checkup` | Trend vs last month, biggest movers, and the top 3 moves worth making |
| `cannibalization_check` | Queries where two of your pages compete — which should win, and how to fix it |
| `striking_distance` | Queries sitting at position 5–15 — the fastest traffic you're not getting, with the fix per page |
| `traffic_drop` | When the drop started, which pages/queries lost, indexed-or-not, most likely cause |
| `indexing_audit` | Sitemap status + index inspection of your top pages, with plain-language fixes |

## Privacy

- **Read-only** Google scope (`webmasters.readonly`).
- Tokens live in `~/.search-console-mcp/credentials.json` on your machine, `chmod 600`. `npx search-console-mcp-server logout` deletes them.
- No telemetry, no proxy — API calls go from your machine to Google, full stop.
- Prefer your own Google Cloud project? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` and it uses yours.

## Who made this

[Percy](https://www.getpercy.io) — an AI Head of SEO that watches your Search Console every week, builds a strategy, tells you exactly what to change, then re-checks the live page and measures the result. This MCP server is the "ask your data anything" half; Percy is the "someone works on it weekly" half.

MIT licensed. Issues and PRs welcome.
