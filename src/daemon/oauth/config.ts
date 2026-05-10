export type OAuthConfig = {
  authMode: "codex" | "mock" | "pkce" | "token";
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scope: string;
  redirectUri: string;
  proxyUrl?: string;
  accessToken?: string;
};

const DEFAULT_SCOPE = "openid profile email";

export function loadOAuthConfig(getPort: () => number): OAuthConfig {
  const baseUrl = trimTrailingSlash(process.env.CODEX_WIDGET_AUTH_BASE_URL);
  const redirectUri =
    process.env.CODEX_WIDGET_OAUTH_REDIRECT_URI ??
    `http://127.0.0.1:${getPort()}/oauth/callback`;

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

export function requireOAuthConfig(getPort: () => number): Required<OAuthConfig> {
  const config = loadOAuthConfig(getPort);
  const missing = getMissingConfigKeys(config);
  if (missing.length > 0) {
    throw new Error(`OAuth is not configured: missing ${missing.join(", ")}.`);
  }
  return config as Required<OAuthConfig>;
}

export function getMissingConfigKeys(config: OAuthConfig): string[] {
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
