export type AuthStatus = {
  mode: "codex" | "oauth-proxy" | "mock";
  configured: boolean;
  authenticated: boolean;
  signInAvailable: boolean;
  signInMethod: "codex" | "pkce" | "token" | null;
  proxyUrl?: string;
  modelLabel?: string;
  reason?: string;
};
