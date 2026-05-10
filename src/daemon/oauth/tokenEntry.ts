export function readTokenEntryUpdates(input: {
  form: URLSearchParams;
  fallbackProxyUrl?: string;
  fallbackModelLabel?: string;
}): Record<string, string> {
  const accessToken = input.form.get("access_token")?.trim();
  const proxyUrl = input.form.get("proxy_url")?.trim() || input.fallbackProxyUrl;
  const modelLabel = input.form.get("model_label")?.trim() || input.fallbackModelLabel || "oauth-token";

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

  return {
    CODEX_WIDGET_AUTH_MODE: "token",
    CODEX_WIDGET_AGENT_PROXY_URL: proxyUrl,
    CODEX_WIDGET_OAUTH_ACCESS_TOKEN: accessToken,
    CODEX_WIDGET_MODEL_LABEL: modelLabel
  };
}
