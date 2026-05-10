import type { ServerResponse } from "node:http";
import type { AuthStatus } from "../shared/protocol.js";
import { upsertLocalEnv } from "./env.js";
import {
  getMissingConfigKeys,
  loadOAuthConfig,
  requireOAuthConfig,
  type OAuthConfig
} from "./oauth/config.js";
import type { TokenSet } from "./oauth/tokens.js";
import {
  writeOAuthCallbackResponse,
  writeOAuthTokenEntryResponse
} from "./oauth/pages.js";
import {
  createPkceAuthorization,
  type PendingAuthorization
} from "./oauth/pkce.js";
import {
  isCodexLoggedIn,
  startCodexLogin,
  type CodexLoginState
} from "./oauth/codexLogin.js";
import { exchangeAuthorizationCodeForTokens } from "./oauth/tokenExchange.js";
import { readTokenEntryUpdates } from "./oauth/tokenEntry.js";

export type OAuthProxyCredentials = {
  proxyUrl?: string;
  accessToken?: string;
  codexAuthenticated?: boolean;
  authenticated: boolean;
  configured: boolean;
};

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

export class OAuthSession {
  private pending?: PendingAuthorization;
  private tokens?: TokenSet;
  private staticTokenSignedOut = false;
  private codexState: CodexLoginState = {
    signInInProgress: false,
    disconnected: false
  };

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
    const authorization = createPkceAuthorization({ config });
    this.pending = authorization.pending;
    return authorization.url;
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
    this.tokens = await exchangeAuthorizationCodeForTokens({ config, pending, code });
  }

  completeTokenEntry(form: URLSearchParams): void {
    const updates = readTokenEntryUpdates({
      form,
      fallbackProxyUrl: this.loadConfig().proxyUrl,
      fallbackModelLabel: process.env.CODEX_WIDGET_MODEL_LABEL
    });

    Object.assign(process.env, updates);
    this.pending = undefined;
    this.tokens = undefined;
    this.staticTokenSignedOut = false;
    upsertLocalEnv(updates);
  }

  logout(): void {
    if (this.loadConfig().authMode === "codex") {
      this.codexState.signInInProgress = false;
      this.codexState.disconnected = true;
      this.codexState.lastError = undefined;
      return;
    }

    this.pending = undefined;
    this.tokens = undefined;
    this.staticTokenSignedOut = Boolean(this.loadConfig().accessToken);
  }

  writeCallbackResponse(response: ServerResponse, ok: boolean, message: string): void {
    writeOAuthCallbackResponse(response, ok, message);
  }

  writeTokenEntryResponse(response: ServerResponse): void {
    const config = this.loadConfig();
    writeOAuthTokenEntryResponse(response, {
      proxyUrl: config.proxyUrl,
      modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL ?? "oauth-token"
    });
  }

  private loadConfig(): OAuthConfig {
    return loadOAuthConfig(this.getPort);
  }

  private requireConfig(): Required<OAuthConfig> {
    return requireOAuthConfig(this.getPort);
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
    const authenticated = loggedIn && !this.codexState.disconnected;
    return {
      mode: "codex",
      configured: true,
      authenticated,
      signInAvailable: true,
      signInMethod: "codex",
      modelLabel: process.env.CODEX_WIDGET_MODEL_LABEL ?? "codex",
      reason: authenticated
        ? undefined
        : this.codexState.signInInProgress
          ? "OpenAI sign-in in progress"
          : loggedIn
            ? "Codex session disconnected from widget"
          : this.codexState.lastError ?? "sign-in required"
    };
  }

  private startCodexSignIn(onAuthChanged: () => void): void {
    startCodexLogin({
      state: this.codexState,
      onAuthChanged
    });
  }
}
