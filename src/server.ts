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
  listSitemaps,
  inspectUrl,
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
  const server = new McpServer({ name: "search-console-mcp", version: "0.1.0" });

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
  // One-shot recipes that orchestrate the tools with real SEO methodology, so
  // the server is useful out of the box — not just a raw API connector. Each
  // shows up as a slash-command in MCP clients that support prompts.

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

  server.prompt(
    "seo_checkup",
    "Full health check: trend, biggest movers, and the top 3 moves worth making",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Run an SEO checkup using the Search Console tools:\n" +
          "1. Pull the last 28 days vs the prior 28 (dimensions ['date'], then ['page'], then ['query']). Summarize the trend in one sentence with real numbers.\n" +
          "2. Find the biggest movers: pages/queries that gained or lost the most clicks between the two periods.\n" +
          "3. Find quick wins: queries at position 4–15 with meaningful impressions but low CTR.\n" +
          "4. End with the TOP 3 moves worth making, ranked by expected payoff — each tied to a specific page or query with its numbers. Be direct and brief; no generic advice.",
      ),
  );

  server.prompt(
    "striking_distance",
    "Queries sitting just off page 1 — the fastest traffic you're not getting",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Find striking-distance opportunities:\n" +
          "1. Query the last 28 days with dimensions ['query','page'], rowLimit 500.\n" +
          "2. Filter to positions 5–15 with impressions above the median — these are one improvement away from page 1.\n" +
          "3. Group by page. For each of the top 5 pages: the queries it's close on, current position, impressions, and the single most likely fix (title rewrite, content section, internal links).\n" +
          "4. Rank by impressions × proximity to page 1. Real numbers on every line.",
      ),
  );

  server.prompt(
    "traffic_drop",
    "Diagnose a traffic drop: what fell, where, and the most likely cause",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Diagnose the traffic drop:\n" +
          "1. Pull daily clicks for the last 90 days (dimensions ['date']) and identify when the drop started.\n" +
          "2. Compare the 28 days before vs after that date, by ['page'] and by ['query'] — isolate WHICH pages and queries lost.\n" +
          "3. For the top 3 losing pages, run inspect_url: still indexed? canonical changed? last crawl?\n" +
          "4. Conclude with the most likely cause (ranking loss vs deindexing vs demand drop vs seasonality — the data distinguishes these) and the first corrective step. If the data is ambiguous, say what would disambiguate it.",
      ),
  );

  server.prompt(
    "indexing_audit",
    "Are your important pages actually indexed? Sitemaps + index status",
    site,
    ({ site: s }) =>
      prompt(
        `${sitePreamble(s)}\n\n` +
          "Run an indexing audit:\n" +
          "1. list_sitemaps — submitted? errors? how many URLs?\n" +
          "2. Pull the top 10 pages by impressions (last 28 days) and inspect_url each: indexed, chosen canonical matches, no mobile issues.\n" +
          "3. Flag anything where Google's canonical differs from the URL, or an important page is not indexed — explain why in plain language and what to change.\n" +
          "4. Keep it tight: a table of page → status → action, then one paragraph of what matters most.",
      ),
  );

  await server.connect(new StdioServerTransport());
}
