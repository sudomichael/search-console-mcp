import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import type { IncomingMessage, RequestListener, Server, ServerResponse, createServer } from "node:http";
import { login } from "../src/auth.js";

const TOKENS = { access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function response() {
  const result = { status: 0, headers: {} as Record<string, string>, body: "", ended: false,
    get writableEnded() { return this.ended; },
    writeHead(status: number, headers: Record<string, string> = {}) { this.status = status; this.headers = headers; return this; },
    end(body = "") { this.body = body; this.ended = true; return this; },
  };
  return result;
}
function setup(overrides: Partial<Parameters<typeof login>[0]> = {}) {
  let handler!: RequestListener;
  let authorization!: URL;
  const saved: unknown[] = [], exchanged: Record<string, string>[] = [], messages: string[] = [];
  let closed = 0, idleClosed = 0;
  const server = Object.assign(new EventEmitter(), {
    listen(_port: number, _host: string, ready: () => void) { ready(); return this; },
    address() { return { port: 32123 }; },
    close() { closed++; return this; },
    closeIdleConnections() { idleClosed++; },
  });
  const promise = login({
    createServer: ((listener: RequestListener) => { handler = listener; return server as unknown as Server; }) as typeof createServer,
    openBrowser: url => { authorization = new URL(url); },
    exchangeToken: async params => { exchanged.push(params); return TOKENS; },
    save: async credentials => { saved.push(credentials); },
    log: message => messages.push(message),
    ...overrides,
  });
  // Failure tests attach their assertions after sending the mocked request.
  void promise.catch(() => {});
  function request(query = "", path = "/callback") {
    const res = response();
    handler({ url: `${path}${query}` } as IncomingMessage, res as unknown as ServerResponse);
    return res;
  }
  return {
    promise, saved, exchanged, messages, server,
    authorization: () => authorization,
    complete: () => request(`?state=${authorization.searchParams.get("state")}&code=test-code`),
    request, closed: () => closed, idleClosed: () => idleClosed,
  };
}

test("redirects to TurboConsole only after exchange AND save, preserving PKCE and local storage", async () => {
  const exchanged = deferred<typeof TOKENS>(), saved = deferred<void>();
  let params: Record<string, string> = {}, credentials: unknown;
  const h = setup({ exchangeToken: async input => { params = input; return exchanged.promise; }, save: async input => { credentials = input; await saved.promise; } });
  const res = h.complete();
  assert.equal(res.status, 0);
  exchanged.resolve(TOKENS); await nextTurn();
  assert.equal(res.status, 0);
  assert.deepEqual(credentials, { access_token: "test-access", refresh_token: "test-refresh", expires_at: (credentials as { expires_at: number }).expires_at });
  assert.ok((credentials as { expires_at: number }).expires_at > Date.now());
  assert.equal(params.redirect_uri, "http://127.0.0.1:32123/callback");
  assert.equal(h.authorization().searchParams.get("code_challenge_method"), "S256");
  assert.equal(h.authorization().searchParams.get("code_challenge"), createHash("sha256").update(params.code_verifier).digest("base64url"));
  saved.resolve(); await h.promise;
  const destination = new URL(res.headers.Location);
  assert.equal(destination.origin, "https://www.turboconsole.io");
  assert.equal(destination.pathname, "/search-console-mcp/connected");
  assert.deepEqual([...destination.searchParams.keys()], ["source", "version"]);
  assert.equal(destination.searchParams.get("source"), "mcp-login");
  assert.match(destination.searchParams.get("version")!, /^\d+\.\d+\.\d+/);
  assert.equal(res.status, 302); assert.equal(res.ended, true);
  assert.equal(h.closed(), 1); assert.equal(h.idleClosed(), 1);
  assert.match(h.messages.at(-1)!, /TurboConsole/);
  assert.doesNotMatch(res.headers.Location, /test-access|test-refresh|test-code/);
});

for (const query of ["?state=wrong&code=code", "?error=access_denied", "?code=code", ""]) {
  test(`rejects invalid OAuth callback ${query || "without parameters"}`, async () => {
    const h = setup(), res = h.request(query);
    await assert.rejects(h.promise, /OAuth callback was invalid/);
    assert.equal(res.status, 400); assert.equal(res.headers.Location, undefined);
    assert.equal(h.exchanged.length, 0); assert.equal(h.saved.length, 0); assert.equal(h.closed(), 1);
    assert.ok(!h.messages.some(message => message.startsWith("Connected.")));
  });
}

for (const phase of ["exchange", "save"] as const) {
  test(`does not redirect after ${phase} failure`, async () => {
    const h = setup(phase === "exchange" ? { exchangeToken: async () => { throw new Error("exchange failed"); } } : { save: async () => { throw new Error("save failed"); } });
    const res = h.complete();
    await assert.rejects(h.promise, new RegExp(`${phase} failed`));
    assert.equal(res.status, 500); assert.equal(res.headers.Location, undefined);
    assert.match(res.body, /rerun/); assert.equal(h.closed(), 1);
    assert.ok(!h.messages.some(message => message.startsWith("Connected.")));
  });
}

test("rejects incomplete credentials before saving", async () => {
  for (const tokens of [{ ...TOKENS, refresh_token: undefined }, { ...TOKENS, access_token: "" }, { ...TOKENS, expires_in: 0 }]) {
    const h = setup({ exchangeToken: async () => tokens });
    const res = h.complete();
    await assert.rejects(h.promise, /incomplete credentials/);
    assert.equal(res.status, 500); assert.equal(h.saved.length, 0); assert.equal(h.closed(), 1);
  }
});

test("ignores unrelated URLs and rejects duplicate callbacks without exchanging twice", async () => {
  const pending = deferred<typeof TOKENS>(); let exchanges = 0;
  const h = setup({ exchangeToken: async () => { exchanges++; return pending.promise; } });
  assert.equal(h.request("", "/favicon.ico").status, 404);
  const first = h.complete(); assert.equal(h.complete().status, 409);
  pending.resolve(TOKENS); await h.promise;
  assert.equal(first.status, 302); assert.equal(exchanges, 1); assert.equal(h.saved.length, 1);
});

test("times out and aborts a hanging exchange without saving or redirecting later", async () => {
  const pending = deferred<typeof TOKENS>(); let signal: AbortSignal | undefined;
  const h = setup({ timeoutMs: 10, exchangeToken: async (_params, inputSignal) => { signal = inputSignal; return pending.promise; } });
  const res = h.complete();
  // The fake listener has no socket to keep Node alive while its unref timer runs.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(h.promise, /Timed out/); }
  finally { clearTimeout(keepAlive); }
  assert.equal(res.status, 504); assert.equal(signal?.aborted, true); assert.equal(h.closed(), 1);
  pending.resolve(TOKENS); await nextTurn();
  assert.equal(res.headers.Location, undefined); assert.equal(h.saved.length, 0);
});

test("closes the listener after startup errors", async () => {
  const h = setup(); h.server.emit("error", new Error("listen failed"));
  await assert.rejects(h.promise, /listen failed/);
  assert.equal(h.closed(), 1); assert.equal(h.idleClosed(), 1);
});
