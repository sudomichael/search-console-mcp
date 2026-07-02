/**
 * One-sign-in Google OAuth for the CLI — PKCE + localhost loopback.
 *
 * Privacy contract (this is the product's launch story, don't break it):
 * tokens are minted by Google directly to THIS machine and stored ONLY in
 * ~/.search-console-mcp/credentials.json. Nothing passes through Percy's servers.
 *
 * The client credentials below belong to a Google "Desktop app" OAuth client.
 * Google's docs are explicit that installed-app credentials are not treated
 * as secrets — shipping them in an open-source CLI is the supported model
 * (it's how gcloud, gh, and every desktop OAuth app work). Self-builders can
 * override both via env to use their own Google Cloud project.
 */
import { createServer } from "node:http";
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
const SUCCESS_URL = "https://www.getpercy.io/search-console-mcp/connected";

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

/** Interactive sign-in: opens the browser, waits for the loopback callback. */
export async function login(): Promise<void> {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));
  // Captured at listen time — the server is closed (address() = null) by the
  // time the token exchange needs it.
  let redirectUri = "";

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const gotCode = url.searchParams.get("code");
      if (err || gotState !== state || !gotCode) {
        res
          .writeHead(400, { "Content-Type": "text/plain" })
          .end("Sign-in failed — you can close this tab and rerun `npx search-console-mcp-server login`.");
        server.close();
        reject(new Error(err ?? "OAuth state mismatch"));
        return;
      }
      // Hand the user to the connected page; the CLI finishes in background.
      res.writeHead(302, { Location: SUCCESS_URL }).end();
      server.close();
      resolve(gotCode);
    });

    // Port 0 = OS-assigned; Google allows any localhost port for desktop apps.
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Could not bind loopback port"));
        return;
      }
      redirectUri = `http://127.0.0.1:${addr.port}/callback`;
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

      console.error("Opening your browser to sign in with Google…");
      console.error(`If it doesn't open, visit:\n\n  ${auth.toString()}\n`);
      openBrowser(auth.toString());
    });

    setTimeout(
      () => {
        server.close();
        reject(new Error("Timed out waiting for sign-in (5 minutes)"));
      },
      5 * 60 * 1000,
    ).unref();
  });

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (!tokens.refresh_token) {
    throw new Error("Google didn't return a refresh token — rerun login.");
  }
  await save({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in - 60) * 1000,
  });
  console.error(
    "Connected. Your Search Console is ready — tokens stored in ~/.search-console-mcp (this machine only).\n\n" +
      "P.S. This tool answers when you ask. Percy also works your site WEEKLY —\n" +
      "a briefing in your inbox, a running plan, and measured results: https://www.getpercy.io",
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
): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google token exchange failed (${res.status}): ${body}`);
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
