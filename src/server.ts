/**
 * The MCP server — four tools over Google Search Console, stdio transport.
 * Results return as compact JSON text; the calling model does the analysis.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  listSites,
  querySearchAnalytics,
  comparePeriods,
  listSitemaps,
  inspectUrl,
  inspectUrls,
} from "./gsc.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 1) }] };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
    isError: true,
  };
}

export async function serve(): Promise<void> {
  const server = new McpServer({ name: "search-console-mcp", version: "0.1.2" });

  server.tool(
    "list_properties",
    "List the Google Search Console properties this account can access. Call this first to get exact siteUrl values (e.g. 'sc-domain:example.com' or 'https://example.com/').",
    {},
    async () => {
      try {
        return ok(await listSites());
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "query_search_analytics",
    "Query real Search Console performance data: clicks, impressions, CTR, and average position, grouped by the dimensions you choose. Dates are YYYY-MM-DD (GSC data lags ~2-3 days). Use dimensions like ['query'], ['page'], ['query','page'], or ['date'] for trends.",
    {
      siteUrl: z.string().describe("Exact property from list_properties"),
      startDate: z.string().describe("YYYY-MM-DD"),
      endDate: z.string().describe("YYYY-MM-DD"),
      dimensions: z
        .array(z.enum(["query", "page", "date", "country", "device"]))
        .optional()
        .describe("Grouping, default ['query']"),
      rowLimit: z.number().int().min(1).max(1000).optional(),
      startRow: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Pagination offset — pass 1000, 2000, … for more rows"),
      searchType: z
        .enum(["web", "image", "video", "news", "discover", "googleNews"])
        .optional()
        .describe("Traffic source — 'discover' shows Google Discover performance"),
      queryContains: z.string().optional().describe("Only queries containing this"),
      pageContains: z.string().optional().describe("Only page URLs containing this"),
    },
    async (a) => {
      try {
        return ok(await querySearchAnalytics(a));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "compare_periods",
    "The biggest-movers analysis, computed for you: this date range vs the prior equal-length range, joined per page (or query) with clicks/impressions/position deltas, sorted by biggest change. Use this for 'what fell/grew', 'this month vs last', and trend diagnosis — it's one call and the math is already done.",
    {
      siteUrl: z.string().describe("Exact property from list_properties"),
      startDate: z.string().describe("Current period start, YYYY-MM-DD"),
      endDate: z.string().describe("Current period end, YYYY-MM-DD"),
      dimension: z
        .enum(["page", "query"])
        .optional()
        .describe("Compare by page (default) or by query"),
      rowLimit: z.number().int().min(1).max(200).optional(),
      searchType: z
        .enum(["web", "image", "video", "news", "discover", "googleNews"])
        .optional(),
    },
    async (a) => {
      try {
        return ok(await comparePeriods(a));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "inspect_url",
    "Google's index status for one URL: is it indexed, why not, canonical chosen by Google, last crawl, mobile/rich-result issues.",
    {
      siteUrl: z.string().describe("Exact property from list_properties"),
      inspectionUrl: z.string().describe("Full URL to inspect"),
    },
    async (a) => {
      try {
        return ok(await inspectUrl(a));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "inspect_urls",
    "Batch index-status check: up to 10 URLs in one call (per-URL errors reported inline). Use for indexing audits instead of ten single calls.",
    {
      siteUrl: z.string().describe("Exact property from list_properties"),
      inspectionUrls: z
        .array(z.string())
        .min(1)
        .max(10)
        .describe("Full URLs to inspect (max 10)"),
    },
    async (a) => {
      try {
        return ok(await inspectUrls(a));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_sitemaps",
    "List submitted sitemaps for a property, with status and counts.",
    {
      siteUrl: z.string().describe("Exact property from list_properties"),
    },
    async (a) => {
      try {
        return ok(await listSitemaps(a.siteUrl));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ── Built-in analyses (MCP prompts) ──────────────────────────────────────
  // One-shot recipes that orchestrate the tools with real SEO methodology —
  // concrete thresholds, cause classification, and prioritization rules — so
  // the server is useful out of the box, not just a raw API connector. Every
  // prompt ends with ranked ACTIONS, never a data dump. Each shows up as a
  // slash-command in MCP clients that support prompts.

  const site = {
    site: z
      .string()
      .optional()
      .describe("Property to analyze (omit to pick from list_properties)"),
  };
  const sitePreamble = (s?: string) =>
    s
      ? `Analyze the Search Console property "${s}".`
      : "First call list_properties and pick the most relevant property (ask me if ambiguous).";
  const prompt = (text: string) => ({
    messages: [
      { role: "user" as const, content: { type: "text" as const, text } },
    ],
  });
  // Rough expected organic CTR by average position (non-brand, web search).
  // Used as the yardstick for "underperforming": under ~half the expected
  // CTR for the position is a metadata problem, not a ranking problem.
  const CTR_BENCHMARK =
    "Expected CTR by position (non-brand web search, rough): pos 1 ≈ 25–30%, pos 2 ≈ 13–16%, pos 3 ≈ 9–11%, pos 4–5 ≈ 5–8%, pos 6–10 ≈ 2–4%, pos 11–20 ≈ 0.5–1.5%. 'Underperforming' = CTR under half the expected value for its position.";

  server.prompt(
    "seo_checkup",
    "Full health check: trend, biggest movers, quick wins — ending in the top 3 moves scored by impact ÷ effort",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Run a full SEO checkup:\n" +
          "1. compare_periods for the last 28 days, dimension 'page' (rowLimit 100), then again with dimension 'query' — the deltas come back computed. Also pull query_search_analytics with dimensions ['date'] over the last 56 days for the trend shape. Open with ONE sentence: total clicks now vs prior period, and whether the trend is steady, improving, or decaying.\n" +
          "2. Biggest movers: top 5 gainers and top 5 losers by deltaClicks. For each loser, classify the cause from its own deltas — position worsened → ranking loss; position flat + impressions flat + clicks down → CTR loss (SERP layout or competitor snippet); impressions down + position flat → demand drop.\n" +
          `3. Quick wins: queries at position 4–15 with impressions above the site median and underperforming CTR. ${CTR_BENCHMARK}\n` +
          "4. Cannibalization spot-check: in a ['query','page'] pull (last 28 days, rowLimit 500), flag any query where 2+ pages each hold a meaningful share of its impressions. Note it for a full cannibalization_check; don't solve it here.\n" +
          "5. Score every candidate action: Impact = monthly clicks at stake, Confidence = how clean the signal is (1–5), Effort = low for title/meta, medium for a content section, high for a rewrite or consolidation. Priority = Impact × Confidence ÷ Effort.\n" +
          "6. ACTIONS: the top 3 moves by that score, ranked. Each names the exact page or query, the specific change, and the expected click gain with real numbers. No generic advice.",
      ),
  );

  server.prompt(
    "traffic_drop",
    "Diagnose an acute traffic drop: when it started, who lost, and whether it's rankings, CTR, indexing, demand, or seasonality",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Diagnose the traffic drop:\n" +
          "1. Pull daily clicks AND impressions for the last 90 days (query_search_analytics, dimensions ['date']). Find the break point: the date where a SUSTAINED decline begins — weekday dips and single bad days are not drops.\n" +
          "2. compare_periods by page, then by query, for the 28 days since the break (the tool compares against the prior 28 automatically) — isolate WHICH pages and queries lost, with numbers.\n" +
          "3. Classify each top loser from its deltas: position worsened → ranking loss; position flat + impressions flat + clicks down → CTR/SERP-feature loss; impressions collapsed with position flat → demand drop or an indexing problem.\n" +
          "4. inspect_urls the top 3 losing pages in ONE batch call: still indexed? Google's chosen canonical changed? crawled recently? A page that lost impressions and fell out of the index is a technical problem, not a ranking one.\n" +
          "5. Seasonality check: pull the same calendar window from one year earlier (dimensions ['date']; GSC keeps ~16 months). If last year shows the same dip, it's seasonal — say so and stand down.\n" +
          "6. ACTIONS: the verdict first (ranking loss / CTR loss / deindexing / demand drop / seasonal), then ranked corrective steps per losing page, most clicks-at-stake first. If the data is genuinely ambiguous, name the ONE check that would settle it.",
      ),
  );

  server.prompt(
    "traffic_decay",
    "Find pages quietly bleeding clicks month over month — catch and refresh them before they crater",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Find slow traffic decay (chronic decline, distinct from an acute drop):\n" +
          "1. compare_periods by page for the last 28 days (rowLimit 100). Then run it again for the last 90 days. A page declining in BOTH windows is decaying; a page down in only one is probably noise.\n" +
          "2. Materiality filter: keep pages with ≥10 clicks in the current period (or ≥20 in the prior) AND a relative click decline ≥20%. Below that, ignore — it's statistical noise.\n" +
          "3. For the top 10 decayers by absolute click loss, pull each page's queries for the current period (query_search_analytics with pageContains, dimensions ['query']) and identify which queries drove the loss.\n" +
          "4. Classify the cause per page: position slid (e.g. 3→7) → content decay, refresh it; clicks fell with stable impressions and position → CTR collapse, fix title/meta; impressions fell across all its queries → demand shift — verify with a year-over-year pull (['date'], same window last year) before touching content; only specific queries lost while others held → a competitor took those intents, close that gap specifically.\n" +
          "5. Rank refresh candidates by click loss × recovery confidence: position-slide losses recover most reliably; demand losses usually don't recover from a rewrite. Mark seasonal suspects 'watch, don't refresh' unless the decline is accelerating.\n" +
          "6. ACTIONS: a ranked table — page → cause → the specific fix — then a short list of stable or growing pages that should NOT be touched.",
      ),
  );

  server.prompt(
    "striking_distance",
    "Queries at position 4–20 ranked by estimated click gain — the fastest traffic you're not getting",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Find striking-distance opportunities:\n" +
          "1. query_search_analytics, last 28 days, dimensions ['query','page'], rowLimit 1000.\n" +
          "2. Band by position: 4–10 = striking distance to the top 3 (small on-page changes move these); 11–20 = page 2 (needs a real content improvement, not just a title). Keep only impressions above the site median; drop brand queries and anything already in the top 3.\n" +
          `3. Estimated uplift per query = impressions × (benchmark CTR at the next band up − current CTR). ${CTR_BENCHMARK} Rank by that uplift, not by raw impressions.\n` +
          "4. Group by page and take the top 5 pages by summed uplift. For each, pick the single most probable fix: query words absent from the title → title rewrite; page ranks but has no section matching the intent → add an H2 + section; content is adequate but the page is weak → internal links from stronger pages (see internal_links).\n" +
          "5. ACTIONS: ranked list — page, its close queries with position/impressions/CTR, the ONE fix, and the estimated monthly click gain. Real numbers on every line.",
      ),
  );

  server.prompt(
    "keyword_opportunities",
    "Every growth lever in one pass: CTR fixes, page-1 pushes, page-2 climbs, and emerging demand — ranked by uplift ÷ effort",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Surface keyword opportunities across four buckets:\n" +
          "1. Pull the last 28 days with dimensions ['query','page'], rowLimit 1000 (paginate with startRow if a full 1000 comes back). Compute the site's median CTR and median impressions. Exclude brand queries and queries already in the top 3 — those are won.\n" +
          `2. Segment: (a) CTR fixes — impressions above median, position ≤10, underperforming CTR (${CTR_BENCHMARK}); (b) striking distance — position 4–10; (c) page-2 pushes — position 11–20 with real impressions; (d) emerging demand — compare_periods by query: impressions up ≥50% but clicks flat, i.e. demand arriving before the page is ready for it.\n` +
          "3. Estimate uplift per opportunity = impressions × (target CTR − current CTR); target = the benchmark at the current position for bucket (a), at the next band up for (b) and (c).\n" +
          "4. Assign effort: (a) low — metadata only; (b) low–medium — on-page tweaks; (c) medium — content work; (d) read the query to judge. Priority = uplift ÷ effort.\n" +
          "5. ACTIONS: the top 10 opportunities across all buckets, ranked by priority — each with query, page, position, current vs target CTR, expected monthly clicks, and the concrete change to make.",
      ),
  );

  server.prompt(
    "cannibalization_check",
    "Find queries where your own pages compete — severity-scored, with one fix per case and the recovery estimate",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Find and resolve keyword cannibalization:\n" +
          "1. Query the last 90 days with dimensions ['query','page'], rowLimit 1000 (paginate with startRow if needed).\n" +
          "2. Flag queries where 2+ pages EACH hold ≥10% of the query's impressions and the query has meaningful volume. Skip brand terms and near-zero noise. Two pages both in the top 5 of a high-volume query is dominance, not cannibalization — skip those too.\n" +
          "3. Severity per case = impressions at stake × proximity: both pages at position 4–20 is the worst case (they actively suppress each other); one page top-3 and one on page 3+ is mild.\n" +
          "4. For the top cases, check position instability: query_search_analytics with dimensions ['query','page','date'] and queryContains the flagged query — pages swapping in and out of the SERP day to day is the classic cannibalization signature.\n" +
          "5. Decide ONE fix per case. Winner = better position + more clicks over the 90 days. Same intent and the weaker page adds nothing distinct → CONSOLIDATE: merge content into the winner, 301 the loser. Genuinely different intents → DIFFERENTIATE: retarget the weaker page's title/H1 at its own intent so they stop colliding. Weaker page has standalone value → LINK: internal link from it to the winner using the query as anchor.\n" +
          "6. Estimate recovery per case: combined impressions × the winner's solo CTR, versus today's split clicks.\n" +
          "7. ACTIONS: cases ranked by impressions at stake — query, both pages' numbers, the ONE fix, expected recovery. If nothing qualifies, say so; a clean bill is a valid result.",
      ),
  );

  server.prompt(
    "title_ctr_rewrite",
    "Pages underperforming their position — with rewritten titles and metas grounded in the real queries",
    {
      ...site,
      page: z
        .string()
        .optional()
        .describe("Focus on one page URL (omit to scan the whole site)"),
    },
    ({ site: s, page: p }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          (p
            ? `Rewrite the title and meta description for ${p}, grounded in its real query data:\n1. Pull the page's performance for the last 28 days: query_search_analytics with pageContains for that URL, dimensions ['page'] for the topline, then ['query'] (rowLimit 100) for the evidence. ${CTR_BENCHMARK}\n`
            : `Find the pages losing the most clicks to weak titles/metas, and rewrite them:\n1. Pull the last 28 days with dimensions ['page'], rowLimit 500. Keep pages with impressions above the site median AND underperforming CTR for their position. ${CTR_BENCHMARK} Rank by missed clicks = impressions × (expected CTR − actual CTR); take the top 5.\n2. For each page, pull its queries (query_search_analytics with pageContains, dimensions ['query'], rowLimit 100).\n`) +
          "Next steps for each page:\n" +
          "- Identify the PRIMARY query (most impressions) and the 1–2 secondary intents worth a word in the metadata.\n" +
          "- Diagnose why the CTR lags: primary query words likely missing from the title (infer the current title from the URL slug and what ranks); intent mismatch (queries are how-to but the page presents as a product page); nothing differentiating (no number, year, outcome, or angle).\n" +
          "- Write the fix, don't describe it: 2–3 exact title options ≤60 characters — each must contain the primary query or a close variant, front-loaded, and differentiate from what generic competitors would say — plus 1–2 meta descriptions ≤155 characters that answer the dominant intent and earn the click honestly (no bait the page can't cash).\n" +
          "ACTIONS: per page — the evidence (top queries, position, CTR vs expected), the recommended title and meta VERBATIM ready to paste, and the expected monthly click gain. Ranked by missed clicks. Close with: re-measure in 2–3 weeks using compare_periods on these pages.",
      ),
  );

  server.prompt(
    "refresh_vs_new",
    "For a given topic: refresh, consolidate, prune, or create new — one verdict from your existing search footprint",
    {
      ...site,
      topic: z
        .string()
        .describe("The topic or keyword to decide on (e.g. 'invoice templates')"),
    },
    ({ site: s, topic }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          `Decide the right content action for the topic "${topic}" — refresh, consolidate, prune, or create new — from the site's existing footprint:\n` +
          `1. Map the footprint: query_search_analytics, last 90 days, queryContains "${topic}" (try close variants too), dimensions ['query','page'], rowLimit 500. Also try pageContains for on-topic URL slugs. Which pages already earn impressions for this topic, at what positions, with what clicks?\n` +
          "2. Demand direction: compare_periods with dimension 'query' — are the topic's impressions growing, flat, or dying?\n" +
          "3. Apply the decision matrix — pick exactly ONE verdict:\n" +
          "   REFRESH — one clear page owns the topic at position ~5–25 with real impressions but flat or declining clicks. Good bones, stale execution: update it.\n" +
          "   CONSOLIDATE — two or more pages split the topic's impressions and none is top-10. Merge into the strongest page (better position + more clicks), 301 the rest to it.\n" +
          "   PRUNE — demand is collapsing period-over-period AND the page has had near-zero clicks for 90 days. Redirect it to the closest surviving page; the topic isn't coming back.\n" +
          "   CREATE NEW — the site gets scattered impressions at position 20+ from pages that aren't actually about the topic. Demand exists; nothing serves it. Write the dedicated page.\n" +
          "4. If the verdict is REFRESH, inspect_url the candidate page first — a page that isn't indexed needs a technical fix before new copy, and the verdict changes.\n" +
          "5. ACTIONS: the verdict and why in two sentences, then the ordered steps (what to merge, redirect, update, or write), the primary query to target, and the real queries from step 1 the content must answer.",
      ),
  );

  server.prompt(
    "internal_links",
    "A source → target → anchor internal-link plan, justified by query overlap Google already sees",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Build an internal-link plan from query/page overlap:\n" +
          "1. TARGETS (pages that need authority and would pay it back): query_search_analytics, last 28 days, dimensions ['query','page'], rowLimit 1000 — keep pages at position 4–15 on queries with above-median impressions.\n" +
          "2. SOURCES (pages with authority to give): the top ~20 pages by clicks over the last 90 days (dimensions ['page'], rowLimit 100).\n" +
          "3. Match by PROVEN topical overlap: a source qualifies for a target only if the source also shows impressions for the target's queries or close variants — that's Google itself confirming the two pages are related. Never propose a link between topically unrelated pages, no matter how strong the source.\n" +
          "4. Anchor text from real queries: use the target's actual query phrasing, varied per link — never the identical exact-match anchor from every source.\n" +
          "5. Cannibalization guard: if a source and target actively compete for the same query (both ranking with split impressions), that pair is a cannibalization case, not a link opportunity — flag it for cannibalization_check and move on.\n" +
          "6. ACTIONS: a table — source page → target page → anchor text → why (the shared queries and the target's position/impressions) — ranked by the target's uplift potential (impressions at stake × proximity to page 1). Suggest 3–10 links; a few right links beat many noisy ones.",
      ),
  );

  server.prompt(
    "indexing_audit",
    "Sitemaps + index status of the pages that matter, triaged by traffic at risk",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Run an indexing audit:\n" +
          "1. list_sitemaps — submitted? errors or warnings? Do the URL counts look sane for the site?\n" +
          "2. Pull the top 10 pages by impressions (last 28 days, dimensions ['page']) and inspect_urls them in ONE batch call: indexed? Google's chosen canonical matches the declared one? crawled recently? mobile or rich-result issues?\n" +
          "3. Catch silent fallout: compare_periods by page, find up to 5 pages that had impressions in the prior period but near-zero now, and batch-inspect those too — pages that fell OUT of the index surface exactly here.\n" +
          "4. Triage every finding by traffic at risk × certainty ÷ effort: an important page not indexed = CRITICAL; Google's canonical pointing somewhere you didn't choose on a traffic page = HIGH (Google is consolidating signals where you don't want them); stale crawl on a frequently-updated page = MEDIUM; sitemap warnings on low-traffic sections = LOW.\n" +
          "5. ACTIONS: a table page → status → fix, ordered by that triage score, then ONE paragraph: the single most important thing to fix this week and why. If everything is clean, say so plainly — that's a valid result.",
      ),
  );

  await server.connect(new StdioServerTransport());
}
