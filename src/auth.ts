/**
 * One-sign-in Google OAuth for the CLI — PKCE + localhost loopback.
 *
 * Privacy contract (this is the product's launch story, don't break it):
 * tokens are minted by Google directly to THIS machine and stored ONLY in
 * ~/.search-console-mcp/credentials.json. Nothing passes through TurboConsole's servers.
 *
 * The client credentials below belong to a Google "Desktop app" OAuth client.
 * Google's docs are explicit that installed-app credentials are not treated
 * as secrets — shipping them in an open-source CLI is the supported model
 * (it's how gcloud, gh, and every desktop OAuth app work). Self-builders can
 * override both via env to use their own Google Cloud project.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rm, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const CLIENT_ID =
  process.env.SEARCH_CONSOLE_MCP_CLIENT_ID ??
  "1032081156097-9tkkokkfd3t3op35t6tt5ggun68clgpt.apps.googleusercontent.com";
const CLIENT_SECRET =
  process.env.SEARCH_CONSOLE_MCP_CLIENT_SECRET ??
  "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";

const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
const SUCCESS_URL = new URL("https://www.turboconsole.io/search-console-mcp/connected");
SUCCESS_URL.searchParams.set("source", "mcp-login");
SUCCESS_URL.searchParams.set("version", version);
const WORKSPACE_URL = "https://www.turboconsole.io/sign-in?source=mcp&workflow=improve-page";

const CRED_DIR = join(homedir(), ".search-console-mcp");
const CRED_FILE = join(CRED_DIR, "credentials.json");

type Credentials = {
  refresh_token: string;
  access_token: string;
  /** Epoch ms when access_token expires. */
  expires_at: number;
};

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  } catch {
    // Fine — the URL is printed to the terminal as the fallback.
  }
}

type LoginDependencies = {
  createServer: typeof createServer;
  openBrowser: (url: string) => void;
  exchangeToken: typeof exchangeToken;
  save: (credentials: Credentials) => Promise<void>;
  log: (message: string) => void;
  timeoutMs: number;
};

/** Interactive sign-in. Optional dependencies keep tests off Google and disk. */
export async function login(options: Partial<LoginDependencies> = {}): Promise<void> {
  const makeServer = options.createServer ?? createServer;
  const open = options.openBrowser ?? openBrowser;
  const exchange = options.exchangeToken ?? exchangeToken;
  const persist = options.save ?? save;
  const print = options.log ?? ((message: string) => console.error(message));
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  const controller = new AbortController();
  let server: Server | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingResponse: ServerResponse | undefined;
  let settled = false;
  let handlingCallback = false;
  let redirectUri = "";

  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const listener = makeServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname !== "/callback") {
          res.writeHead(404, { Connection: "close" }).end();
          return;
        }
        if (handlingCallback || settled) {
          res.writeHead(409, { Connection: "close" }).end("Sign-in is already being processed.");
          return;
        }
        const code = url.searchParams.get("code");
        if (url.searchParams.get("error") || url.searchParams.get("state") !== state || !code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" })
            .end("Sign-in failed. Close this tab and rerun `npx search-console-mcp-server login`.");
          finish(new Error("Google sign-in was declined or the OAuth callback was invalid."));
          return;
        }
        handlingCallback = true;
        pendingResponse = res;
        void (async () => {
          try {
            const tokens = await exchange({
              grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri,
            }, controller.signal);
            if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token || typeof tokens.access_token !== "string" || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
              throw new Error("Google returned incomplete credentials. Rerun login.");
            }
            if (settled) return;
            await persist({
              refresh_token: tokens.refresh_token,
              access_token: tokens.access_token,
              expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
            });
            if (settled) return;
            // No success page until both Google and the local credential save succeeded.
            res.writeHead(302, { Location: SUCCESS_URL.toString(), Connection: "close" }).end();
            finish();
          } catch (error) {
            if (settled) return;
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" })
              .end("Sign-in could not finish. No success was confirmed. Check your terminal and rerun `npx search-console-mcp-server login`.");
            finish(error instanceof Error ? error : new Error("Sign-in could not finish."));
          }
        })();
      });
      server = listener;
      listener.once("error", finish);
      timer = setTimeout(() => {
        if (settled) return;
        pendingResponse?.writeHead(504, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" })
          .end("Sign-in timed out. Rerun `npx search-console-mcp-server login`.");
        finish(new Error("Timed out waiting for sign-in (5 minutes). Rerun login."));
        controller.abort();
      }, options.timeoutMs ?? 5 * 60 * 1000);
      timer.unref();
      // Google permits an OS-assigned localhost port for desktop OAuth clients.
      listener.listen(0, "127.0.0.1", () => {
        const address = listener.address();
        if (!address || typeof address === "string") {
          finish(new Error("Could not bind loopback port"));
          return;
        }
        redirectUri = `http://127.0.0.1:${address.port}/callback`;
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", CLIENT_ID);
        auth.searchParams.set("redirect_uri", redirectUri);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("scope", SCOPE);
        auth.searchParams.set("code_challenge", challenge);
        auth.searchParams.set("code_challenge_method", "S256");
        auth.searchParams.set("access_type", "offline");
        auth.searchParams.set("prompt", "consent");
        auth.searchParams.set("state", state);
        print("Opening your browser to sign in with Google…");
        print(`If it doesn't open, visit:\n\n  ${auth.toString()}\n`);
        try { open(auth.toString()); }
        catch (error) { finish(error instanceof Error ? error : new Error("Could not open sign-in.")); }
      });
    });
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    if (pendingResponse && !pendingResponse.writableEnded) {
      pendingResponse.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", Connection: "close" })
        .end("Sign-in did not finish. Rerun `npx search-console-mcp-server login`.");
    }
    server?.close();
    server?.closeIdleConnections?.();
  }
  print(
    "Connected. Your Search Console is ready — tokens stored in ~/.search-console-mcp (this machine only).\n\n" +
    "Want a page change you can review and publish? TurboConsole adds researched drafts, " +
    "change verification, and follow-through. Separate Google connection; paid plans after the free trial.\n" +
    WORKSPACE_URL,
  );
}

export async function logout(): Promise<void> {
  await rm(CRED_FILE, { force: true });
  console.error("Signed out — local credentials deleted.");
}

/** A valid access token, refreshing transparently. Throws if never logged in. */
export async function accessToken(): Promise<string> {
  const creds = await load();
  if (!creds) {
    throw new Error(
      "Not signed in. Run `npx search-console-mcp-server login` first (one-time, 30 seconds).",
    );
  }
  if (Date.now() < creds.expires_at) return creds.access_token;
  const tokens = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: creds.refresh_token,
  });
  const next: Credentials = {
    refresh_token: tokens.refresh_token ?? creds.refresh_token,
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
  };
  await save(next);
  return next.access_token;
}

async function exchangeToken(
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed (${res.status}). Rerun login.`);
  }
  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
}

async function load(): Promise<Credentials | null> {
  try {
    return JSON.parse(await readFile(CRED_FILE, "utf8")) as Credentials;
  } catch {
    return null;
  }
}

async function save(creds: Credentials): Promise<void> {
  await mkdir(CRED_DIR, { recursive: true });
  await writeFile(CRED_FILE, JSON.stringify(creds, null, 2));
  await chmod(CRED_FILE, 0o600);
}
