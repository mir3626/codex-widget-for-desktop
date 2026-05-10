import { parseTokenSet, type TokenSet } from "./tokens.js";
import type { OAuthConfig } from "./config.js";
import type { PendingAuthorization } from "./pkce.js";

export async function exchangeAuthorizationCodeForTokens(input: {
  config: Required<OAuthConfig>;
  pending: PendingAuthorization;
  code: string;
}): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.pending.redirectUri,
    client_id: input.config.clientId,
    code_verifier: input.pending.codeVerifier
  });

  const response = await fetch(input.config.tokenUrl, {
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

  return parseTokenSet(await response.json());
}
