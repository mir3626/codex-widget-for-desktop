import { createHash, randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { AuthStatus } from "../shared/protocol.js";
import { spawnCodex, spawnCodexSync } from "./codexCli.js";
import { upsertLocalEnv } from "./env.js";

type OAuthConfig = {
  authMode: "codex" | "mock" | "pkce" | "token";
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope: string;
  redirectUri: string;
  proxyUrl?: string;
  accessToken?: string;
};

type PendingAuthorization = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope?: string;
};

export type OAuthProxyCredentials = {
  proxyUrl?: string;
  accessToken?: string;
  codexAuthenticated?: boolean;
  authenticated: boolean;
  configured: boolean;
};

const DEFAULT_SCOPE = "openid profile email";
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

export class OAuthSession {
  private pending?: PendingAuthorization;
  private tokens?: TokenSet;
  private staticTokenSignedOut = false;
  private codexSignInInProgress = false;
  private codexDisconnected = false;
  private codexLastError?: string;

  constructor(private readonly getPort: () => number) {}

  getStatus(): AuthStatus {
    const config = this.loadConfig();
    if (config.authMode === "mock") {
      return {
        mode: "mock",
        configured: false,
        authenticated: false,
        signInAvailable: false,
        signInMethod: null,
        modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL ?? "demo",
        reason: "mock mode"
      };
    }

    if (config.authMode === "codex") {
      return this.getCodexStatus();
    }

    if (config.accessToken && config.proxyUrl) {
      return {
        mode: "oauth-proxy",
        configured: true,
        authenticated: !this.staticTokenSignedOut,
        signInAvailable: true,
        signInMethod: "token",
        proxyUrl: config.proxyUrl,
        modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL,
        reason: this.staticTokenSignedOut ? "configured OAuth token signed out until daemon restart" : undefined
      };
    }

    const missing = getMissingConfigKeys(config);
    const configured = missing.length === 0;
    const authenticated = configured && this.hasValidAccessToken();

    if (!configured) {
      return {
        mode: config.authMode === "token" ? "oauth-proxy" : "mock",
        configured: false,
        authenticated: false,
        signInAvailable: config.authMode === "token",
        signInMethod: config.authMode === "token" ? "token" : null,
        proxyUrl: config.proxyUrl,
        modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL,
        reason: `missing ${missing.join(", ")}`
      };
    }

    return {
      mode: "oauth-proxy",
      configured: true,
      authenticated,
      signInAvailable: true,
      signInMethod: config.authMode,
      proxyUrl: config.proxyUrl,
      modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL,
      reason: authenticated ? undefined : "sign-in required"
    };
  }

  getProxyCredentials(): OAuthProxyCredentials {
    const config = this.loadConfig();
    const status = this.getStatus();
    return {
      proxyUrl: config.proxyUrl,
      accessToken: status.authenticated ? this.getAccessToken(config) : undefined,
      codexAuthenticated: config.authMode === "codex" && status.authenticated,
      authenticated: status.authenticated,
      configured: status.configured
    };
  }

  startSignIn(onAuthChanged: () => void): string | undefined {
    const config = this.loadConfig();
    if (config.authMode === "codex") {
      this.startCodexSignIn(onAuthChanged);
      return undefined;
    }

    if (config.authMode === "token") {
      return `http://127.0.0.1:${this.getPort()}/oauth/token`;
    }

    return this.createAuthorizationUrl();
  }

  createAuthorizationUrl(): string {
    const config = this.requireConfig();
    const state = randomBase64Url(24);
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
    const authorizationUrl = new URL(config.authorizationUrl);

    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("scope", config.scope);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    this.pending = {
      state,
      codeVerifier,
      redirectUri: config.redirectUri,
      createdAt: Date.now()
    };

    return authorizationUrl.toString();
  }

  async completeCallback(callbackUrl: URL): Promise<void> {
    const error = callbackUrl.searchParams.get("error");
    if (error) {
      throw new Error(callbackUrl.searchParams.get("error_description") ?? error);
    }

    const code = callbackUrl.searchParams.get("code");
    const state = callbackUrl.searchParams.get("state");
    if (!code || !state) {
      throw new Error("OAuth callback is missing code or state.");
    }

    const pending = this.pending;
    this.pending = undefined;
    if (!pending || pending.state !== state) {
      throw new Error("OAuth callback state does not match an active sign-in.");
    }
    if (Date.now() - pending.createdAt > PENDING_AUTH_TTL_MS) {
      throw new Error("OAuth sign-in timed out. Try again.");
    }

    const config = this.requireConfig();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirectUri,
      client_id: config.clientId,
      code_verifier: pending.codeVerifier
    });

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      throw new Error(`OAuth token exchange failed (${response.status}).`);
    }

    this.tokens = parseTokenSet(await response.json());
  }

  completeTokenEntry(form: URLSearchParams): void {
    const accessToken = form.get("access_token")?.trim();
    const proxyUrl = form.get("proxy_url")?.trim() || this.loadConfig().proxyUrl;
    const modelLabel = form.get("model_label")?.trim() || process.env.CODEX_WIDGET_MODEL_LABEL || "oauth-token";

    if (!accessToken) {
      throw new Error("OAuth access token is required.");
    }
    if (!proxyUrl) {
      throw new Error("Agent proxy URL is required.");
    }

    const parsedProxyUrl = new URL(proxyUrl);
    if (parsedProxyUrl.protocol !== "http:" && parsedProxyUrl.protocol !== "https:") {
      throw new Error("Agent proxy URL must use http or https.");
    }

    const updates = {
      CODEX_WIDGET_AUTH_MODE: "token",
      CODEX_WIDGET_AGENT_PROXY_URL: proxyUrl,
      CODEX_WIDGET_OAUTH_ACCESS_TOKEN: accessToken,
      CODEX_WIDGET_MODEL_LABEL: modelLabel
    };

    Object.assign(process.env, updates);
    this.pending = undefined;
    this.tokens = undefined;
    this.staticTokenSignedOut = false;
    upsertLocalEnv(updates);
  }

  logout(): void {
    if (this.loadConfig().authMode === "codex") {
      this.codexSignInInProgress = false;
      this.codexDisconnected = true;
      this.codexLastError = undefined;
      return;
    }

    this.pending = undefined;
    this.tokens = undefined;
    this.staticTokenSignedOut = Boolean(this.loadConfig().accessToken);
  }

  writeCallbackResponse(response: ServerResponse, ok: boolean, message: string): void {
    response.writeHead(ok ? 200 : 400, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Codex Widget OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; color: #1c2430; }
      main { max-width: 520px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.55; color: #526172; }
    </style>
  </head>
  <body>
    <main>
      <h1>${ok ? "OAuth 연결 완료" : "OAuth 연결 실패"}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`);
  }

  writeTokenEntryResponse(response: ServerResponse): void {
    const config = this.loadConfig();
    const proxyUrl = escapeHtml(config.proxyUrl ?? "");
    const modelLabel = escapeHtml(process.env.CODEX_WIDGET_MODEL_LABEL ?? "oauth-token");

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Codex Widget OAuth Token</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; color: #1c2430; background: #f7faf9; }
      main { max-width: 680px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.55; color: #526172; }
      label { display: block; margin: 18px 0 7px; font-weight: 650; }
      input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #ccd7d5; border-radius: 8px; padding: 11px 12px; font: inherit; background: #fff; color: #1c2430; }
      textarea { min-height: 130px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      button { margin-top: 18px; border: 0; border-radius: 8px; padding: 11px 16px; background: #197a68; color: #fff; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>OAuth token 연결</h1>
      <p>토큰과 프록시 주소를 저장하면 위젯이 바로 Bearer token으로 agent proxy에 연결합니다. 저장 값은 이 프로젝트의 gitignored .env에만 기록됩니다.</p>
      <form method="post" action="/oauth/token">
        <label for="proxy_url">Agent proxy URL</label>
        <input id="proxy_url" name="proxy_url" value="${proxyUrl}" placeholder="http://127.0.0.1:8787/agent/stream" required />
        <label for="model_label">Widget label</label>
        <input id="model_label" name="model_label" value="${modelLabel}" />
        <label for="access_token">OAuth access token</label>
        <textarea id="access_token" name="access_token" autocomplete="off" spellcheck="false" required autofocus></textarea>
        <button type="submit">Save token</button>
      </form>
    </main>
  </body>
</html>`);
  }

  private loadConfig(): OAuthConfig {
    const baseUrl = trimTrailingSlash(process.env.CODEX_WIDGET_AUTH_BASE_URL);
    const redirectUri =
      process.env.CODEX_WIDGET_OAUTH_REDIRECT_URI ??
      `http://127.0.0.1:${this.getPort()}/oauth/callback`;

    return {
      authMode:
        process.env.CODEX_WIDGET_AUTH_MODE === "token"
          ? "token"
          : process.env.CODEX_WIDGET_AUTH_MODE === "pkce"
            ? "pkce"
            : process.env.CODEX_WIDGET_AUTH_MODE === "mock"
              ? "mock"
              : "codex",
      authorizationUrl:
        process.env.CODEX_WIDGET_OAUTH_AUTHORIZE_URL ?? resolveAuthBaseUrl(baseUrl, "/oauth/authorize"),
      tokenUrl: process.env.CODEX_WIDGET_OAUTH_TOKEN_URL ?? resolveAuthBaseUrl(baseUrl, "/oauth/token"),
      clientId: process.env.CODEX_WIDGET_OAUTH_CLIENT_ID,
      scope: process.env.CODEX_WIDGET_OAUTH_SCOPE ?? DEFAULT_SCOPE,
      redirectUri,
      proxyUrl: process.env.CODEX_WIDGET_AGENT_PROXY_URL ?? resolveAuthBaseUrl(baseUrl, "/agent/stream"),
      accessToken: process.env.CODEX_WIDGET_OAUTH_ACCESS_TOKEN
    };
  }

  private requireConfig(): Required<OAuthConfig> {
    const config = this.loadConfig();
    const missing = getMissingConfigKeys(config);
    if (missing.length > 0) {
      throw new Error(`OAuth is not configured: missing ${missing.join(", ")}.`);
    }
    return config as Required<OAuthConfig>;
  }

  private hasValidAccessToken(): boolean {
    return Boolean(this.getAccessToken());
  }

  private getAccessToken(config = this.loadConfig()): string | undefined {
    if (config.accessToken && !this.staticTokenSignedOut) {
      return config.accessToken;
    }

    if (!this.tokens) {
      return undefined;
    }
    if (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 30_000) {
      this.tokens = undefined;
      return undefined;
    }
    return this.tokens.accessToken;
  }

  private getCodexStatus(): AuthStatus {
    const loggedIn = isCodexLoggedIn();
    const authenticated = loggedIn && !this.codexDisconnected;
    return {
      mode: "codex",
      configured: true,
      authenticated,
      signInAvailable: true,
      signInMethod: "codex",
      modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL ?? "codex",
      reason: authenticated
        ? undefined
        : this.codexSignInInProgress
          ? "OpenAI sign-in in progress"
          : loggedIn
            ? "Codex session disconnected from widget"
          : this.codexLastError ?? "sign-in required"
    };
  }

  private startCodexSignIn(onAuthChanged: () => void): void {
    if (isCodexLoggedIn()) {
      this.codexSignInInProgress = false;
      this.codexDisconnected = false;
      this.codexLastError = undefined;
      queueMicrotask(onAuthChanged);
      return;
    }

    if (this.codexSignInInProgress) {
      return;
    }

    this.codexSignInInProgress = true;
    this.codexLastError = undefined;
    const child = spawnCodex(["login"], {
      cwd: process.cwd(),
      stdio: "ignore",
      windowsHide: true
    });

    child.on("error", (error) => {
      this.codexSignInInProgress = false;
      this.codexLastError = error.message;
      onAuthChanged();
    });

    child.on("exit", (code) => {
      this.codexSignInInProgress = false;
      this.codexLastError = code === 0 ? undefined : `codex login exited with ${code ?? "unknown"}`;
      onAuthChanged();
    });
  }
}

function isCodexLoggedIn(): boolean {
  const result = spawnCodexSync(["login", "status"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 10_000
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return result.status === 0 && /Logged in/i.test(output);
}

function parseTokenSet(value: unknown): TokenSet {
  if (!isRecord(value) || typeof value.access_token !== "string") {
    throw new Error("OAuth token response did not include an access token.");
  }

  const expiresIn = typeof value.expires_in === "number" ? value.expires_in : undefined;
  return {
    accessToken: value.access_token,
    refreshToken: typeof value.refresh_token === "string" ? value.refresh_token : undefined,
    tokenType: typeof value.token_type === "string" ? value.token_type : "Bearer",
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    scope: typeof value.scope === "string" ? value.scope : undefined
  };
}

function getMissingConfigKeys(config: OAuthConfig): string[] {
  const missing: string[] = [];
  if (config.authMode === "token" || config.accessToken) {
    if (!config.proxyUrl) {
      missing.push("CODEX_WIDGET_AGENT_PROXY_URL");
    }
    if (!config.accessToken) {
      missing.push("CODEX_WIDGET_OAUTH_ACCESS_TOKEN");
    }
    return missing;
  }

  if (!config.authorizationUrl) {
    missing.push("CODEX_WIDGET_OAUTH_AUTHORIZE_URL");
  }
  if (!config.tokenUrl) {
    missing.push("CODEX_WIDGET_OAUTH_TOKEN_URL");
  }
  if (!config.clientId) {
    missing.push("CODEX_WIDGET_OAUTH_CLIENT_ID");
  }
  if (!config.proxyUrl) {
    missing.push("CODEX_WIDGET_AGENT_PROXY_URL");
  }
  return missing;
}

function resolveAuthBaseUrl(baseUrl: string | undefined, path: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  return new URL(path, baseUrl).toString();
}

function trimTrailingSlash(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, "");
}

function randomBase64Url(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
