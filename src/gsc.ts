/**
 * Thin Google Search Console REST client — plain fetch, no googleapis
 * dependency, so `npx` startup stays instantly.
 */
import { accessToken } from "./auth.js";

const LOGIN_CMD = "npx search-console-mcp-server login";
const REAUTH_MESSAGE = `Your Google sign-in expired or was revoked. Run: ${LOGIN_CMD}`;
const TIMEOUT_MS = 30_000;

/** Backoff before each 429 retry (mutable so tests can zero it). */
export const retryDelaysMs = [1000, 3000];

function apiDetail(text: string): string {
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) detail = parsed.error.message;
  } catch {
    // Not JSON — use the raw text.
  }
  return detail.slice(0, 300);
}

async function call<T>(url: string, body?: unknown): Promise<T> {
  let token = await accessToken();
  let refreshed = false;
  let retries = 0;
  for (;;) {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return (await res.json()) as T;
    const detail = apiDetail(await res.text().catch(() => ""));
    const suffix = detail ? ` (${detail})` : "";
    if (res.status === 401) {
      if (!refreshed) {
        refreshed = true;
        token = await accessToken(true);
        continue;
      }
      throw new Error(`${REAUTH_MESSAGE}${suffix}`);
    }
    if (res.status === 403) {
      throw new Error(
        "No access to this property with the signed-in Google account. Run list_properties to see the exact siteUrl values you can use (domain properties look like sc-domain:example.com)." +
          suffix,
      );
    }
    if (res.status === 429) {
      if (retries < retryDelaysMs.length) {
        await new Promise((r) => setTimeout(r, retryDelaysMs[retries++]));
        continue;
      }
      throw new Error(`Search Console quota hit — wait a minute and retry.${suffix}`);
    }
    throw new Error(`Search Console API ${res.status}: ${detail}`);
  }
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

type Metrics = { clicks: number; impressions: number; position: number | null };

export type PeriodDelta = {
  key: string;
  current: Metrics;
  previous: Metrics;
  deltaClicks: number;
  deltaImpressions: number;
  /** Negative = improved (moved toward #1). Null when the key is in only one period. */
  deltaPosition: number | null;
};

const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

/** Rounds ctr to 4 decimals and position/deltaPosition to 1, recursively. */
export function roundMetrics<T>(value: T): T {
  const round = (n: number, d: number) => {
    const f = 10 ** d;
    return Math.round(n * f) / f;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === "number" && k === "ctr") out[k] = round(x, 4);
        else if (typeof x === "number" && (k === "position" || k === "deltaPosition")) out[k] = round(x, 1);
        else out[k] = walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

function parseDate(label: string, value: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ${label} "${value}" — use a real date as YYYY-MM-DD.`);
  }
  return d;
}

/**
 * The analysis every SEO wants first: this period vs the prior equal-length
 * one, joined per page/query with deltas, sorted by biggest absolute click
 * change. Each period is paginated up to 5,000 rows; the join is done HERE —
 * models fumble multi-call arithmetic, so the tool owns it.
 */
export async function comparePeriods(args: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimension?: "page" | "query";
  rowLimit?: number;
  searchType?: string;
}): Promise<{
  periodDays: number;
  previousRange: string;
  truncated: boolean;
  note?: string;
  rows: PeriodDelta[];
}> {
  const start = parseDate("startDate", args.startDate);
  const end = parseDate("endDate", args.endDate);
  if (end.getTime() < start.getTime()) {
    throw new Error(`endDate ${args.endDate} is before startDate ${args.startDate}.`);
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const prevEnd = new Date(start.getTime() - 86_400_000);
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);

  const dim = args.dimension ?? "page";
  const fetchPeriod = async (startDate: string, endDate: string) => {
    const rows: SearchAnalyticsRow[] = [];
    let capped = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch = await querySearchAnalytics({
        siteUrl: args.siteUrl,
        dimensions: [dim],
        rowLimit: PAGE_SIZE,
        startRow: page * PAGE_SIZE,
        searchType: args.searchType,
        startDate,
        endDate,
      });
      rows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      if (page === MAX_PAGES - 1) capped = true;
    }
    return { rows, capped };
  };
  const [cur, prev] = await Promise.all([
    fetchPeriod(args.startDate, args.endDate),
    fetchPeriod(ymd(prevStart), ymd(prevEnd)),
  ]);

  const byKey = new Map<string, PeriodDelta>();
  for (const r of cur.rows) {
    const key = r.keys?.[0] ?? "";
    byKey.set(key, {
      key,
      current: { clicks: r.clicks, impressions: r.impressions, position: r.position },
      previous: { clicks: 0, impressions: 0, position: null },
      deltaClicks: r.clicks,
      deltaImpressions: r.impressions,
      deltaPosition: null,
    });
  }
  for (const r of prev.rows) {
    const key = r.keys?.[0] ?? "";
    const row = byKey.get(key);
    if (row) {
      row.previous = { clicks: r.clicks, impressions: r.impressions, position: r.position };
      row.deltaClicks = row.current.clicks - r.clicks;
      row.deltaImpressions = row.current.impressions - r.impressions;
      row.deltaPosition = (row.current.position ?? r.position) - r.position;
    } else {
      byKey.set(key, {
        key,
        current: { clicks: 0, impressions: 0, position: null },
        previous: { clicks: r.clicks, impressions: r.impressions, position: r.position },
        deltaClicks: -r.clicks,
        deltaImpressions: -r.impressions,
        deltaPosition: null,
      });
    }
  }
  const rows = [...byKey.values()]
    .sort((a, b) => Math.abs(b.deltaClicks) - Math.abs(a.deltaClicks))
    .slice(0, Math.min(args.rowLimit ?? 50, 200));
  const truncated = cur.capped || prev.capped;
  return {
    periodDays: days,
    previousRange: `${ymd(prevStart)}..${ymd(prevEnd)}`,
    truncated,
    ...(truncated
      ? {
          note: `At least one period has more than ${PAGE_SIZE * MAX_PAGES} rows, so only the top ${PAGE_SIZE * MAX_PAGES} per period were compared. Rows with no position on one side ("new"/"lost") may simply be outside the top ${PAGE_SIZE * MAX_PAGES} in that period, not truly new or lost.`,
        }
      : {}),
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

/**
 * Inspect up to 10 URLs, 3 at a time (the inspection API is the slow one —
 * a full indexing audit shouldn't take ten round trips from the model).
 * Per-URL failures return an error string instead of sinking the batch.
 */
export async function inspectUrls(args: {
  siteUrl: string;
  inspectionUrls: string[];
}): Promise<{ url: string; result: unknown }[]> {
  const urls = args.inspectionUrls.slice(0, 10);
  const out: { url: string; result: unknown }[] = [];
  for (let i = 0; i < urls.length; i += 3) {
    const chunk = urls.slice(i, i + 3);
    const results = await Promise.all(
      chunk.map(async (url) => ({
        url,
        result: await inspectUrl({
          siteUrl: args.siteUrl,
          inspectionUrl: url,
        }).catch((e: unknown) => ({
          error: e instanceof Error ? e.message : String(e),
        })),
      })),
    );
    out.push(...results);
  }
  return out;
}
