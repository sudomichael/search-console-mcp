<div align="center">

# search-console-mcp

**Search Console was built for dashboards. This gives you a conversation instead.**

Talk to your Google Search Console from Claude, Cursor, or any MCP client.

One sign-in. 30 seconds. *No Google Cloud project. No API keys. Tokens never leave your machine.*

[![npm](https://img.shields.io/npm/v/search-console-mcp-server)](https://www.npmjs.com/package/search-console-mcp-server)
[![license](https://img.shields.io/npm/l/search-console-mcp-server)](./LICENSE)
[![node](https://img.shields.io/node/v/search-console-mcp-server)](https://nodejs.org)

[Docs](https://www.getpercy.io/search-console-mcp) · [npm](https://www.npmjs.com/package/search-console-mcp-server) · [Report an issue](https://github.com/sudomichael/search-console-mcp/issues)

</div>

<!-- TODO(launch): hero GIF here — login → consent → "Connected." → asking Claude "which pages lost clicks this month?" -->

---

```
 Google Search Console
          │
          ▼
  search-console-mcp        ← runs on your machine, read-only
          │
          ▼
  Claude / Cursor / any MCP client
          │
          ▼
  "Why did my traffic drop?"
```

Every other Search Console MCP server makes you create a Google Cloud project, enable APIs, and wrangle service-account JSON. This one doesn't:

```bash
npx search-console-mcp-server login
```

Your browser opens, you sign in with Google, done. Tokens are minted by Google directly to your machine and stored **only** in `~/.search-console-mcp/` — nothing passes through anyone's servers.

|  | This server | Typical GSC MCP setup |
| --- | --- | --- |
| Setup | `npx … login`, sign in, done (~30s) | Create a Google Cloud project, enable the API, create OAuth credentials, download JSON, point config at it |
| Runtime | Node — `npx`, nothing to install | Python + uv/venv |
| Can it modify your site data? | **Impossible** — read-only scope by construction | Write scopes with destructive ops "disabled by default" |
| Analyses | 5 built-in (checkup, cannibalization, striking distance, traffic drop, indexing audit) | Bring your own prompts |

## What to expect on first run

```
$ npx search-console-mcp-server login
Opening your browser to sign in with Google…

Connected. Your Search Console is ready — tokens stored in
~/.search-console-mcp (this machine only).
```

That's the whole setup. No clone, no Google Cloud console, no JSON files.

---

## What it feels like

```
You:  Which of my pages are closest to page one?

Claude:  Three real opportunities, by impressions at stake:

  1. /pricing — "scoreboard app pricing" sits at position 11.2 with
     2,400 impressions/mo and almost no clicks. One position-group
     jump is worth ~90 clicks/mo. The title doesn't contain the
     query; start there.

  2. /templates/trivia — position 12.8 on "trivia scoreboard",
     1,100 impressions/mo. The page ranks but has no H2 matching
     the intent.

  3. /blog/keep-score-online — position 9.4, already page one on
     some days. It's cannibalizing with /features — run
     cannibalization_check before touching it.
```

*(Illustrative output — shape and numbers are what the tools return from your real data.)*

## Built-in SEO analysts

Five ready-made analyses ship as MCP prompts — slash-commands in clients that support them. Outcomes, not API calls:

| Prompt | What you get |
| --- | --- |
| `seo_checkup` | Trend vs last month, biggest movers, and the top 3 moves worth making |
| `cannibalization_check` | Queries where two of your pages compete — which should win, and how to fix it |
| `striking_distance` | Queries sitting at position 5–15 — the fastest traffic you're not getting, with the fix per page |
| `traffic_drop` | When the drop started, which pages/queries lost, indexed-or-not, most likely cause |
| `indexing_audit` | Sitemap status + index inspection of your top pages, with plain-language fixes |

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

**3. Ask:**

- *"Which of my pages lost the most clicks this month vs last?"*
- *"Show my queries sitting at position 8–15 with real impressions — what's closest to page 1?"*
- *"Is https://mysite.com/pricing indexed? If not, why?"*
- *"How much Google Discover traffic do I get?"*

## Tools

| Tool | What it does |
| --- | --- |
| `list_properties` | Your GSC properties (call first — gives exact `siteUrl` values) |
| `query_search_analytics` | Clicks / impressions / CTR / position by query, page, date, country, device — filters, pagination, and every traffic source **including Google Discover** |
| `compare_periods` | Biggest movers, computed for you: this period vs the prior one, per-page or per-query deltas, sorted by change |
| `inspect_url` | Google's index status for a URL: indexed or not, why, chosen canonical, last crawl |
| `inspect_urls` | The same, batched — up to 10 URLs in one call for indexing audits |
| `list_sitemaps` | Submitted sitemaps with status |

Read-only by construction: the Google scope this tool requests (`webmasters.readonly`) **cannot** modify your properties, submit sitemaps, or change anything — not "disabled by default." Impossible.

What a `compare_periods` call hands your model (the model never does date arithmetic):

```json
{ "key": "https://example.com/pricing",
  "current":  { "clicks": 1040, "impressions": 20502, "position": 6.4 },
  "previous": { "clicks": 1070, "impressions": 17176, "position": 5.8 },
  "deltaClicks": -30, "deltaImpressions": 3326, "deltaPosition": 0.6 }
```

## Privacy

- **Read-only** Google scope (`webmasters.readonly`).
- Tokens live in `~/.search-console-mcp/credentials.json` on your machine, `chmod 600`. `npx search-console-mcp-server logout` deletes them.
- No telemetry, no proxy — API calls go from your machine to Google, full stop.
- Prefer your own Google Cloud project? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` and it uses yours.

## FAQ / Troubleshooting

**How can the login work without me creating Google credentials?**
The CLI ships a Google "Desktop app" OAuth client — the same supported model `gcloud` and GitHub's CLI use. Your tokens are still minted by Google directly to your machine (PKCE + localhost callback); they never touch our servers. The entire auth path is ~200 lines in [`src/auth.ts`](src/auth.ts) — read it. Want zero shared anything? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` with your own credentials.

**Switch Google accounts?**
`npx search-console-mcp-server login` again — Google shows the account picker.

**"Not signed in" errors in my MCP client?**
Run the login from the same user account your client runs under; credentials live in `~/.search-console-mcp/`.

**A property is missing from `list_properties`.**
The signed-in Google account needs at least "Restricted" access to it in Search Console.

**Why is yesterday missing from the data?**
Google Search Console data lags ~2–3 days. That's Google, not the tool. History goes back ~16 months.

**Revoke access?**
`npx search-console-mcp-server logout` deletes local tokens; [myaccount.google.com/permissions](https://myaccount.google.com/permissions) revokes the grant itself.

## Development

```bash
git clone https://github.com/sudomichael/search-console-mcp
cd search-console-mcp && npm install
npm run dev      # run from source
npm run build    # bundle to dist/ (10KB, no googleapis dependency)
```

The entire auth path is ~200 lines in [`src/auth.ts`](src/auth.ts). To verify any privacy claim above, read the source.

---

### Looking for something proactive?

This MCP server helps you *investigate* — you ask, it answers.

After a week you may notice you keep asking the same questions: *What dropped? What's closest to page one? What should I fix?*

[**Percy**](https://www.getpercy.io) is the other half: he checks your Search Console every week on his own, builds a strategy, emails you exactly what to change — then re-checks the live page and measures whether it worked.

Exploration here. Execution there. Same philosophy: real data, plain English, no dashboards.

---

MIT licensed. Issues and PRs welcome. Built by [Percy](https://www.getpercy.io).
