#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const port = Number(process.env.CODEX_WIDGET_DEV_AUTH_PROXY_PORT ?? 8787);
const host = "127.0.0.1";
const authCodes = new Map();
const accessTokens = new Map();

let listening = false;
let keepAliveTimer;

const server = createServer((request, response) => {
  void handleRequest(request, response);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`[dev-auth-proxy] port ${port} already in use; assuming an external auth proxy`);
    keepAliveTimer = setInterval(() => undefined, 2_147_483_647);
    return;
  }

  console.error(`[dev-auth-proxy] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

server.listen(port, host, () => {
  listening = true;
  console.log(`[dev-auth-proxy] listening on http://${host}:${port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleRequest(request, response) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);

  try {
    if (request.method === "GET" && url.pathname === "/health") {
      writeJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && url.pathname === "/oauth/authorize") {
      writeAuthorizePage(response, url.searchParams);
      return;
    }

    if (request.method === "POST" && url.pathname === "/oauth/authorize/continue") {
      const form = new URLSearchParams(await readRequestBody(request));
      completeAuthorize(response, form);
      return;
    }

    if (request.method === "POST" && url.pathname === "/oauth/token") {
      const form = new URLSearchParams(await readRequestBody(request));
      completeTokenExchange(response, form);
      return;
    }

    if (request.method === "POST" && url.pathname === "/agent/stream") {
      await streamAgentResponse(request, response);
      return;
    }

    response
      .writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
      .end("Codex Widget dev auth proxy");
  } catch (error) {
    writeJson(response, 400, {
      error: "invalid_request",
      error_description: error instanceof Error ? error.message : "Request failed"
    });
  }
}

function writeAuthorizePage(response, params) {
  const clientId = getRequiredParam(params, "client_id");
  const redirectUri = getRequiredParam(params, "redirect_uri");
  const state = getRequiredParam(params, "state");
  const scope = params.get("scope") ?? "";
  const codeChallenge = getRequiredParam(params, "code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "plain";

  if (!isLoopbackRedirectUri(redirectUri)) {
    throw new Error("redirect_uri must point to localhost or 127.0.0.1 for the dev auth proxy.");
  }

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Codex Widget Sign in</title>
    <style>
      :root { color-scheme: light; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17202a; background: #f5f7f8; }
      main { width: min(420px, calc(100vw - 40px)); border: 1px solid #dce4e5; border-radius: 10px; padding: 28px; background: #ffffff; box-shadow: 0 18px 48px rgba(21, 32, 43, 0.08); }
      h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.2; }
      p { margin: 0 0 22px; color: #5d6a76; line-height: 1.55; }
      button { width: 100%; height: 44px; border: 0; border-radius: 8px; color: #ffffff; background: #197a68; font: inherit; font-weight: 700; cursor: pointer; }
      small { display: block; margin-top: 14px; color: #7d8a96; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main>
      <h1>Codex Widget</h1>
      <p>Continue with the local development account to complete the OAuth flow.</p>
      <form method="post" action="/oauth/authorize/continue">
        ${hiddenInput("client_id", clientId)}
        ${hiddenInput("redirect_uri", redirectUri)}
        ${hiddenInput("state", state)}
        ${hiddenInput("scope", scope)}
        ${hiddenInput("code_challenge", codeChallenge)}
        ${hiddenInput("code_challenge_method", codeChallengeMethod)}
        <button type="submit" autofocus>Continue</button>
      </form>
      <small>This development proxy is for local widget testing only.</small>
    </main>
  </body>
</html>`);
}

function completeAuthorize(response, form) {
  const clientId = getRequiredParam(form, "client_id");
  const redirectUri = getRequiredParam(form, "redirect_uri");
  const state = getRequiredParam(form, "state");
  const scope = form.get("scope") ?? "";
  const codeChallenge = getRequiredParam(form, "code_challenge");
  const codeChallengeMethod = form.get("code_challenge_method") ?? "plain";

  if (!isLoopbackRedirectUri(redirectUri)) {
    throw new Error("redirect_uri must point to localhost or 127.0.0.1 for the dev auth proxy.");
  }

  const code = randomBase64Url(32);
  authCodes.set(code, {
    clientId,
    redirectUri,
    scope,
    codeChallenge,
    codeChallengeMethod,
    createdAt: Date.now()
  });

  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set("code", code);
  callbackUrl.searchParams.set("state", state);
  response.writeHead(302, {
    Location: callbackUrl.toString(),
    "Cache-Control": "no-store"
  });
  response.end();
}

function completeTokenExchange(response, form) {
  const grantType = getRequiredParam(form, "grant_type");
  const code = getRequiredParam(form, "code");
  const redirectUri = getRequiredParam(form, "redirect_uri");
  const clientId = getRequiredParam(form, "client_id");
  const codeVerifier = getRequiredParam(form, "code_verifier");

  if (grantType !== "authorization_code") {
    throw new Error("unsupported grant_type");
  }

  const authorization = authCodes.get(code);
  authCodes.delete(code);
  if (!authorization) {
    throw new Error("authorization code is invalid or already used");
  }
  if (Date.now() - authorization.createdAt > 10 * 60 * 1000) {
    throw new Error("authorization code expired");
  }
  if (authorization.redirectUri !== redirectUri || authorization.clientId !== clientId) {
    throw new Error("authorization request mismatch");
  }
  if (!verifyPkce(codeVerifier, authorization.codeChallenge, authorization.codeChallengeMethod)) {
    throw new Error("PKCE verification failed");
  }

  const accessToken = `dev-${randomBase64Url(32)}`;
  accessTokens.set(accessToken, {
    clientId,
    scope: authorization.scope,
    expiresAt: Date.now() + 60 * 60 * 1000
  });

  writeJson(response, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    scope: authorization.scope
  });
}

async function streamAgentResponse(request, response) {
  const token = getBearerToken(request.headers.authorization);
  const session = token ? accessTokens.get(token) : undefined;
  if (!session || Date.now() > session.expiresAt) {
    writeJson(response, 401, { error: "unauthorized" });
    return;
  }

  const body = parseMaybeJson(await readRequestBody(request));
  const input = isRecord(body) && typeof body.input === "string" ? body.input : "";
  const mode = isRecord(body) && typeof body.mode === "string" ? body.mode : "agent";
  const text = [
    "Dev auth proxy is connected. ",
    `Mode: ${mode}. `,
    input ? `You asked: ${input}. ` : "",
    "Replace this local proxy with a real OAuth backend when you are ready for production model calls."
  ].join("");

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });

  for (const chunk of chunkText(text, 18)) {
    response.write(`data: ${JSON.stringify({ delta: chunk })}\n\n`);
    await delay(35);
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function getRequiredParam(params, name) {
  const value = params.get(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getBearerToken(value) {
  if (!value) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function verifyPkce(verifier, challenge, method) {
  if (method === "S256") {
    return base64Url(createHash("sha256").update(verifier).digest()) === challenge;
  }
  if (method === "plain") {
    return verifier === challenge;
  }
  return false;
}

function isLoopbackRedirectUri(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response, status, value) {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    })
    .end(JSON.stringify(value));
}

function hiddenInput(name, value) {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseMaybeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function chunkText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function randomBase64Url(bytes) {
  return base64Url(randomBytes(bytes));
}

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown() {
  clearInterval(keepAliveTimer);
  if (!listening) {
    process.exit(0);
    return;
  }
  server.close(() => process.exit(0));
}
