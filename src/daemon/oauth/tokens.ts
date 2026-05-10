export type TokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope?: string;
};

export function parseTokenSet(value: unknown): TokenSet {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
