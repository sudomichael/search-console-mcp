/**
 * Thin Google Search Console REST client — plain fetch, no googleapis
 * dependency, so `npx percy-gsc` starts instantly.
 */
import { accessToken } from "./auth.js";

async function call<T>(url: string, body?: unknown): Promise<T> {
  const token = await accessToken();
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Search Console API ${res.status}: ${text.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export type SiteEntry = { siteUrl: string; permissionLevel: string };

export async function listSites(): Promise<SiteEntry[]> {
  const data = await call<{ siteEntry?: SiteEntry[] }>(
    "https://www.googleapis.com/webmasters/v3/sites",
  );
  return data.siteEntry ?? [];
}

export type SearchAnalyticsRow = {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export async function querySearchAnalytics(args: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions?: string[];
  rowLimit?: number;
  /** Substring filters, ANDed. */
  queryContains?: string;
  pageContains?: string;
}): Promise<SearchAnalyticsRow[]> {
  const filters = [
    args.queryContains
      ? { dimension: "query", operator: "contains", expression: args.queryContains }
      : null,
    args.pageContains
      ? { dimension: "page", operator: "contains", expression: args.pageContains }
      : null,
  ].filter(Boolean);
  const data = await call<{ rows?: SearchAnalyticsRow[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(args.siteUrl)}/searchAnalytics/query`,
    {
      startDate: args.startDate,
      endDate: args.endDate,
      dimensions: args.dimensions ?? ["query"],
      rowLimit: Math.min(args.rowLimit ?? 100, 1000),
      ...(filters.length
        ? { dimensionFilterGroups: [{ filters }] }
        : {}),
    },
  );
  return data.rows ?? [];
}

export async function listSitemaps(siteUrl: string): Promise<unknown[]> {
  const data = await call<{ sitemap?: unknown[] }>(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`,
  );
  return data.sitemap ?? [];
}

export async function inspectUrl(args: {
  siteUrl: string;
  inspectionUrl: string;
}): Promise<unknown> {
  const data = await call<{ inspectionResult?: unknown }>(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    { inspectionUrl: args.inspectionUrl, siteUrl: args.siteUrl },
  );
  return data.inspectionResult ?? data;
}
