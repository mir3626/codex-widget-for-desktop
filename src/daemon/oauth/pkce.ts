import { createHash, randomBytes } from "node:crypto";
import type { OAuthConfig } from "./config.js";

export type PendingAuthorization = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

export function createPkceAuthorization(input: {
  config: Required<OAuthConfig>;
  now?: number;
}): { url: string; pending: PendingAuthorization } {
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(48);
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const authorizationUrl = new URL(input.config.authorizationUrl);

  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", input.config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", input.config.redirectUri);
  authorizationUrl.searchParams.set("scope", input.config.scope);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return {
    url: authorizationUrl.toString(),
    pending: {
      state,
      codeVerifier,
      redirectUri: input.config.redirectUri,
      createdAt: input.now ?? Date.now()
    }
  };
}

function randomBase64Url(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
