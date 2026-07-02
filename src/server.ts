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
  const server = new McpServer({ name: "percy-gsc", version: "0.1.0" });

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

  await server.connect(new StdioServerTransport());
}
