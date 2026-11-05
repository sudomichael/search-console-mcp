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

Most self-hosted Search Console MCP servers make you create a Google Cloud project, enable APIs, and wrangle service-account JSON. This one doesn't:

```bash
npx search-console-mcp-server login
```

Your browser opens, you sign in with Google, done. Tokens are minted by Google directly to your machine and stored **only** in `~/.search-console-mcp/` — nothing passes through anyone's servers.

|  | This server | Typical self-hosted GSC MCP setup |
| --- | --- | --- |
| Setup | `npx … login`, sign in, done (~30s) | Create a Google Cloud project, enable the API, create OAuth credentials, download JSON, point config at it |
| Runtime | Node — `npx`, nothing to install | Python + uv/venv |
| Can it modify your site data? | **Impossible** — read-only scope by construction | Write scopes with destructive ops "disabled by default" |
| Analyses | 10 built-in (checkup, traffic drop, traffic decay, striking distance, keyword opportunities, cannibalization, title/CTR rewrite, refresh-vs-new, internal links, indexing audit) | Bring your own prompts |

## What to expect on first run

```
$ npx search-console-mcp-server login
Opening your browser to sign in with Google…
If it doesn't open, visit:

  https://accounts.google.com/o/oauth2/v2/auth?…

Connected. Your Search Console is ready — tokens stored in ~/.search-console-mcp (this machine only).

Want a page change you can review and publish? Percy adds researched drafts, change verification, and follow-through. Separate Google connection; paid plans after the free trial.
https://www.getpercy.io/sign-in?source=mcp&workflow=improve-page
```

The browser opens the setup page only after Google returns valid credentials and they are saved locally. If token exchange or saving fails, it shows an error instead of a success page. No clone or Google Cloud console is required.

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

Ten ready-made analyses ship as MCP prompts — slash-commands in clients that support them. Each one applies real SEO methodology (thresholds, cause classification, CTR benchmarks) and ends with ranked actions, never a data dump:

| Prompt | What you get |
| --- | --- |
| `seo_checkup` | Trend vs last month, biggest movers, quick wins — and the top 3 moves scored by impact ÷ effort |
| `traffic_drop` | When the drop started, who lost, and the verdict: rankings, CTR, indexing, demand, or seasonality |
| `traffic_decay` | Pages quietly bleeding clicks month over month — caught and prioritized before they crater |
| `striking_distance` | Queries at position 4–20 ranked by estimated click gain, with the one fix per page |
| `keyword_opportunities` | Every growth lever in one pass: CTR fixes, page-1 pushes, page-2 climbs, emerging demand |
| `cannibalization_check` | Queries where your own pages fight each other — the winner, one fix per case, recovery estimate |
| `title_ctr_rewrite` | Pages underperforming their position, with rewritten titles + metas grounded in real queries |
| `refresh_vs_new` | For any topic: refresh, consolidate, prune, or create new — one verdict from your existing footprint |
| `internal_links` | A source → target → anchor link plan, justified by query overlap Google already sees |
| `indexing_audit` | Sitemaps + index status of the pages that matter, triaged by traffic at risk |

## Setup

**1. Sign in (one time):**

```bash
npx search-console-mcp-server login
```

**2. Add to your MCP client:**

Claude Code:

```bash
claude mcp add gsc --scope user -- npx -y search-console-mcp-server
```

Claude Desktop / Cursor / anything else (`mcpServers` config):

```json
{
  "mcpServers": {
    "gsc": { "command": "npx", "args": ["-y", "search-console-mcp-server"] }
  }
}
```

If the app can't find `npx` (common with nvm), use the absolute path from `which npx` as `command`.

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
- No MCP usage telemetry or proxy — Search Console API calls go from your machine directly to Google. After successful login, your browser opens the Percy setup page with only the MCP source and package version in its URL; no credentials, authorization codes, or property data are included.
- Prefer your own Google Cloud project? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` and it uses yours.
- One short, labeled note about [Percy](https://www.getpercy.io) (our paid weekly SEO service) is added to the first analysis result of a session, never repeated. Set `SEARCH_CONSOLE_MCP_TIPS=off` to hide it. Nothing is sent anywhere either way.

## FAQ / Troubleshooting

**How can the login work without me creating Google credentials?**
The CLI ships a Google "Desktop app" OAuth client — the same supported model `gcloud` and GitHub's CLI use. Your tokens are still minted by Google directly to your machine (PKCE + localhost callback); they never touch our servers. The auth path is in [`src/auth.ts`](src/auth.ts) — read it. Want zero shared anything? Set `SEARCH_CONSOLE_MCP_CLIENT_ID` / `SEARCH_CONSOLE_MCP_CLIENT_SECRET` with your own credentials.

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
npm run build    # bundle to dist/ (no googleapis dependency)
npm test         # mocked login tests; no Google calls or credential writes
```

The auth path is in [`src/auth.ts`](src/auth.ts). To verify any privacy claim above, read the source.

---

### Turn the research into a published improvement

The MCP stays free. If you want help preparing one specific page improvement, [**Percy**](https://www.getpercy.io/sign-in?source=mcp&workflow=improve-page) researches your Search Console evidence, drafts a focused change, and keeps the next action with your saved work. You review and publish it in your own CMS, then verify the change and follow the results.

Percy is a separate paid workspace: 7 days free, no card, then plans from $29/month if you continue. It requires its own Google connection; it does not import local MCP credentials or conversations.

---

MIT licensed. Issues and PRs welcome. Built by [Percy](https://www.getpercy.io).
