/**
 * Thin Google Search Console REST client — plain fetch, no googleapis
 * dependency, so `npx` startup stays instantly.
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
  /** Row offset for pagination beyond 1,000 rows per call. */
  startRow?: number;
  /** web (default) | image | video | news | discover | googleNews. */
  searchType?: string;
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
      ...(args.startRow ? { startRow: args.startRow } : {}),
      ...(args.searchType && args.searchType !== "web"
        ? { type: args.searchType }
        : {}),
      ...(filters.length
        ? { dimensionFilterGroups: [{ filters }] }
        : {}),
    },
  );
  return data.rows ?? [];
}

export type PeriodDelta = {
  key: string;
  current: { clicks: number; impressions: number; position: number };
  previous: { clicks: number; impressions: number; position: number };
  deltaClicks: number;
  deltaImpressions: number;
  /** Negative = improved (moved toward #1). */
  deltaPosition: number;
};

/**
 * The analysis every SEO wants first: this period vs the prior equal-length
 * one, joined per page/query with deltas, sorted by biggest absolute click
 * change. Two API calls + the join done HERE — models fumble multi-call
 * arithmetic, so the tool owns it.
 */
export async function comparePeriods(args: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimension?: "page" | "query";
  rowLimit?: number;
  searchType?: string;
}): Promise<{ periodDays: number; previousRange: string; rows: PeriodDelta[] }> {
  const start = new Date(`${args.startDate}T00:00:00Z`);
  const end = new Date(`${args.endDate}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const dim = args.dimension ?? "page";
  const shared = {
    siteUrl: args.siteUrl,
    dimensions: [dim],
    rowLimit: 1000,
    searchType: args.searchType,
  };
  const [cur, prev] = await Promise.all([
    querySearchAnalytics({
      ...shared,
      startDate: args.startDate,
      endDate: args.endDate,
    }),
    querySearchAnalytics({
      ...shared,
      startDate: ymd(prevStart),
      endDate: ymd(prevEnd),
    }),
  ]);

  const byKey = new Map<string, PeriodDelta>();
  for (const r of cur) {
    const key = r.keys?.[0] ?? "";
    byKey.set(key, {
      key,
      current: { clicks: r.clicks, impressions: r.impressions, position: r.position },
      previous: { clicks: 0, impressions: 0, position: 0 },
      deltaClicks: r.clicks,
      deltaImpressions: r.impressions,
      deltaPosition: 0,
    });
  }
  for (const r of prev) {
    const key = r.keys?.[0] ?? "";
    const row = byKey.get(key);
    if (row) {
      row.previous = { clicks: r.clicks, impressions: r.impressions, position: r.position };
      row.deltaClicks = row.current.clicks - r.clicks;
      row.deltaImpressions = row.current.impressions - r.impressions;
      row.deltaPosition = row.current.position - r.position;
    } else {
      byKey.set(key, {
        key,
        current: { clicks: 0, impressions: 0, position: 0 },
        previous: { clicks: r.clicks, impressions: r.impressions, position: r.position },
        deltaClicks: -r.clicks,
        deltaImpressions: -r.impressions,
        deltaPosition: 0,
      });
    }
  }
  const rows = [...byKey.values()]
    .sort((a, b) => Math.abs(b.deltaClicks) - Math.abs(a.deltaClicks))
    .slice(0, Math.min(args.rowLimit ?? 50, 200));
  return {
    periodDays: days,
    previousRange: `${ymd(prevStart)}..${ymd(prevEnd)}`,
    rows,
  };
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
