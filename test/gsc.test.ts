import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, beforeEach, afterEach } from "node:test";

// Point credentials at a temp HOME before auth.ts reads homedir() at import.
const home = mkdtempSync(join(tmpdir(), "gsc-test-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
mkdirSync(join(home, ".search-console-mcp"));
writeFileSync(
  join(home, ".search-console-mcp", "credentials.json"),
  JSON.stringify({ refresh_token: "r", access_token: "a", expires_at: Date.now() + 3_600_000 }),
);
const { comparePeriods, roundMetrics, querySearchAnalytics, retryDelaysMs } = await import("../src/gsc.js");
retryDelaysMs.splice(0, retryDelaysMs.length, 0, 0);

const realFetch = globalThis.fetch;
let calls: { url: string; body: any }[] = [];
function mockFetch(handler: (url: string, body: any, n: number) => Response) {
  calls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = typeof init?.body === "string" && String(url).includes("googleapis.com/webmasters") || String(url).includes("urlInspection") ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    return handler(String(url), body, calls.length);
  }) as typeof fetch;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const rows = (n: number, prefix: string, startAt = 0) =>
  Array.from({ length: n }, (_, i) => ({
    keys: [`${prefix}${startAt + i}`], clicks: 1, impressions: 10, ctr: 0.1, position: 3,
  }));

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

const args = { siteUrl: "sc-domain:x.com", startDate: "2026-10-08", endDate: "2026-10-14" };

test("one-sided keys get null position and null deltaPosition", async () => {
  mockFetch((_u, body) =>
    json({
      rows: body.startDate === "2026-10-08"
        ? [{ keys: ["new"], clicks: 5, impressions: 50, ctr: 0.1, position: 4 },
           { keys: ["both"], clicks: 5, impressions: 50, ctr: 0.1, position: 4 }]
        : [{ keys: ["lost"], clicks: 7, impressions: 70, ctr: 0.1, position: 2 },
           { keys: ["both"], clicks: 3, impressions: 30, ctr: 0.1, position: 5 }],
    }),
  );
  const r = await comparePeriods(args);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x]));
  assert.equal(by.new.previous.position, null);
  assert.equal(by.new.deltaPosition, null);
  assert.equal(by.lost.current.position, null);
  assert.equal(by.lost.deltaPosition, null);
  assert.equal(by.both.deltaPosition, -1);
  assert.equal(r.truncated, false);
  assert.equal(r.note, undefined);
  assert.equal(r.previousRange, "2026-10-01..2026-10-07");
});

test("paginates and flags truncation at 5000 rows", async () => {
  mockFetch((_u, body) => json({ rows: rows(1000, "k", body.startRow ?? 0) }));
  const r = await comparePeriods(args);
  assert.equal(calls.length, 10); // 5 pages x 2 periods
  assert.equal(r.truncated, true);
  assert.match(r.note ?? "", /new|lost/);
});

test("stops paginating when a page is short", async () => {
  mockFetch((_u, body) => json({ rows: (body.startRow ?? 0) === 0 ? rows(1000, "k") : rows(10, "k", 1000) }));
  const r = await comparePeriods(args);
  assert.equal(calls.length, 4);
  assert.equal(r.truncated, false);
});

test("invalid and inverted dates throw", async () => {
  mockFetch(() => json({ rows: [] }));
  await assert.rejects(comparePeriods({ ...args, startDate: "2026-13-01" }), /Invalid startDate/);
  await assert.rejects(comparePeriods({ ...args, endDate: "yesterday" }), /Invalid endDate/);
  await assert.rejects(comparePeriods({ ...args, startDate: "2026-10-20", endDate: "2026-10-10" }), /before startDate/);
  assert.equal(calls.length, 0);
});

test("403 maps to a list_properties hint", async () => {
  mockFetch(() => json({ error: { message: "User does not have sufficient permission" } }, 403));
  await assert.rejects(querySearchAnalytics(args), /No access to this property.*list_properties.*sc-domain:example\.com.*sufficient permission/);
});

test("429 retries twice then reports quota", async () => {
  mockFetch(() => json({ error: { message: "rate" } }, 429));
  await assert.rejects(querySearchAnalytics(args), /quota hit — wait a minute and retry/);
  assert.equal(calls.length, 3);
});

test("429 then success returns rows", async () => {
  mockFetch((_u, _b, n) => (n === 1 ? json({}, 429) : json({ rows: rows(1, "a") })));
  const r = await querySearchAnalytics(args);
  assert.equal(r.length, 1);
});

test("401 refreshes once then succeeds", async () => {
  mockFetch((url, _b, n) => {
    if (url.includes("oauth2.googleapis.com")) return json({ access_token: "fresh", expires_in: 3600 });
    return n === 1 ? json({}, 401) : json({ rows: rows(1, "a") });
  });
  const r = await querySearchAnalytics(args);
  assert.equal(r.length, 1);
  assert.equal(calls.filter((c) => c.url.includes("oauth2")).length, 1);
});

test("401 after refresh gives the re-login message", async () => {
  mockFetch((url) =>
    url.includes("oauth2.googleapis.com") ? json({ access_token: "fresh", expires_in: 3600 }) : json({}, 401),
  );
  await assert.rejects(querySearchAnalytics(args), /expired or was revoked\. Run: npx search-console-mcp-server login/);
});

test("roundMetrics rounds ctr, position and deltaPosition", () => {
  const out = roundMetrics({
    rows: [{ ctr: 0.123456, position: 3.14159, deltaPosition: -1.26, clicks: 3.5, current: { position: 7.77 } }],
  });
  assert.deepEqual(out, {
    rows: [{ ctr: 0.1235, position: 3.1, deltaPosition: -1.3, clicks: 3.5, current: { position: 7.8 } }],
  });
  assert.equal(roundMetrics({ position: null }).position, null);
});
