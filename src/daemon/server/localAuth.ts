import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const DAEMON_AUTH_TOKEN_HEADER = "x-codex-widget-daemon-token";
export const DAEMON_AUTH_NONCE_HEADER = "x-codex-widget-daemon-nonce";
export const DAEMON_AUTH_WEBSOCKET_QUERY_PARAM = "daemonToken";

const DEFAULT_NONCE_TTL_MS = 30_000;
const MAX_NONCES = 512;
const CORS_METHODS = "GET,POST,OPTIONS";
const CORS_HEADERS = [
  "content-type",
  DAEMON_AUTH_TOKEN_HEADER,
  DAEMON_AUTH_NONCE_HEADER
].join(",");

type OriginKind = "native" | "browser" | "extension";

type OriginDecision = {
  trusted: boolean;
  kind: OriginKind;
  origin?: string;
  reason?: string;
};

type AuthDecision = {
  ok: true;
} | {
  ok: false;
  status: 401 | 403 | 409;
  code: string;
  error: string;
};

type NonceRecord = {
  scope: string;
  expiresAt: number;
};

export type DaemonLocalAuth = ReturnType<typeof createDaemonLocalAuth>;

export function createDaemonLocalAuth(input: {
  token?: string;
  nonceTtlMs?: number;
} = {}) {
  const token = input.token ?? randomBytes(32).toString("base64url");
  const nonceTtlMs = input.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS;
  const nonces = new Map<string, NonceRecord>();

  function describeHandshake() {
    return {
      token,
      header: DAEMON_AUTH_TOKEN_HEADER,
      nonceHeader: DAEMON_AUTH_NONCE_HEADER,
      websocketQueryParam: DAEMON_AUTH_WEBSOCKET_QUERY_PARAM,
      nonceTtlMs
    };
  }

  function classifyRequestOrigin(request: IncomingMessage): OriginDecision {
    return classifyOrigin(readHeader(request, "origin"));
  }

  function applyCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
    const decision = classifyRequestOrigin(request);
    if (!decision.trusted || !decision.origin) {
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", decision.origin);
    response.setHeader("Access-Control-Allow-Methods", CORS_METHODS);
    response.setHeader("Access-Control-Allow-Headers", CORS_HEADERS);
    response.setHeader("Vary", appendVary(response.getHeader("Vary"), "Origin"));
  }

  function handlePreflight(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (request.method !== "OPTIONS" || !isCorsManagedRoute(url.pathname)) {
      return false;
    }
    const originDecision = classifyRequestOrigin(request);
    if (!originDecision.trusted) {
      response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: false, error: originDecision.reason ?? "Origin is not allowed.", code: "origin_denied" }));
      return true;
    }
    applyCorsHeaders(request, response);
    response.writeHead(204).end();
    return true;
  }

  function handleAuthRoute(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    if (!isAuthRoute(url.pathname)) {
      return false;
    }
    const originDecision = classifyRequestOrigin(request);
    if (!originDecision.trusted) {
      response.writeHead(403, { "Content-Type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: false, error: originDecision.reason ?? "Origin is not allowed.", code: "origin_denied" }));
      return true;
    }
    applyCorsHeaders(request, response);

    if (url.pathname === "/daemon/auth/handshake" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: true, auth: describeHandshake() }));
      return true;
    }

    if (url.pathname === "/daemon/auth/nonce" && request.method === "GET") {
      const tokenDecision = authorizeToken(request);
      if (!tokenDecision.ok) {
        response.writeHead(tokenDecision.status, { "Content-Type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ ok: false, error: tokenDecision.error, code: tokenDecision.code }));
        return true;
      }
      const method = normalizeMethod(url.searchParams.get("method") ?? "");
      const path = normalizePath(url.searchParams.get("path") ?? "");
      if (!method || !path) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" })
          .end(JSON.stringify({ ok: false, error: "Nonce requires method and path.", code: "nonce_scope_required" }));
        return true;
      }
      const nonce = createNonce(method, path);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
        .end(JSON.stringify({ ok: true, auth: { nonce, nonceHeader: DAEMON_AUTH_NONCE_HEADER, expiresInMs: nonceTtlMs } }));
      return true;
    }

    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" })
      .end(JSON.stringify({ ok: false, error: "Unknown daemon auth route." }));
    return true;
  }

  function authorizeHttp(request: IncomingMessage, url: URL): AuthDecision {
    const originDecision = classifyRequestOrigin(request);
    if (!originDecision.trusted) {
      return {
        ok: false,
        status: 403,
        code: "origin_denied",
        error: originDecision.reason ?? "Origin is not allowed."
      };
    }
    if (!requiresBrowserMutationAuth(originDecision, request.method ?? "GET", url.pathname)) {
      return { ok: true };
    }
    const tokenDecision = authorizeToken(request);
    if (!tokenDecision.ok) {
      return tokenDecision;
    }
    const nonce = readHeader(request, DAEMON_AUTH_NONCE_HEADER);
    if (!nonce) {
      return {
        ok: false,
        status: 409,
        code: "nonce_required",
        error: "Daemon nonce is required for browser-origin mutations."
      };
    }
    if (!consumeNonce(nonce, request.method ?? "GET", url.pathname)) {
      return {
        ok: false,
        status: 409,
        code: "nonce_invalid_or_replayed",
        error: "Daemon nonce is invalid, expired, or already used."
      };
    }
    return { ok: true };
  }

  function authorizeWebSocketUpgrade(request: IncomingMessage): AuthDecision {
    const originDecision = classifyRequestOrigin(request);
    if (!originDecision.trusted) {
      return {
        ok: false,
        status: 403,
        code: "origin_denied",
        error: originDecision.reason ?? "Origin is not allowed."
      };
    }
    if (originDecision.kind !== "browser") {
      return { ok: true };
    }
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const provided = requestUrl.searchParams.get(DAEMON_AUTH_WEBSOCKET_QUERY_PARAM);
    if (!provided || !safeEquals(provided, token)) {
      return {
        ok: false,
        status: 401,
        code: "daemon_token_required",
        error: "Daemon token is required for browser-origin WebSocket connections."
      };
    }
    return { ok: true };
  }

  function createNonce(method: string, path: string): string {
    pruneExpiredNonces();
    while (nonces.size >= MAX_NONCES) {
      const oldest = nonces.keys().next().value;
      if (!oldest) {
        break;
      }
      nonces.delete(oldest);
    }
    const nonce = randomBytes(24).toString("base64url");
    nonces.set(nonce, {
      scope: nonceScope(method, path),
      expiresAt: Date.now() + nonceTtlMs
    });
    return nonce;
  }

  function consumeNonce(nonce: string, method: string, path: string): boolean {
    pruneExpiredNonces();
    const record = nonces.get(nonce);
    if (!record || record.expiresAt < Date.now() || record.scope !== nonceScope(method, path)) {
      return false;
    }
    nonces.delete(nonce);
    return true;
  }

  function authorizeToken(request: IncomingMessage): AuthDecision {
    const provided = readHeader(request, DAEMON_AUTH_TOKEN_HEADER);
    if (!provided || !safeEquals(provided, token)) {
      return {
        ok: false,
        status: 401,
        code: "daemon_token_required",
        error: "Daemon token is required."
      };
    }
    return { ok: true };
  }

  function pruneExpiredNonces(): void {
    const now = Date.now();
    for (const [nonce, record] of nonces) {
      if (record.expiresAt < now) {
        nonces.delete(nonce);
      }
    }
  }

  return {
    token,
    tokenHeader: DAEMON_AUTH_TOKEN_HEADER,
    nonceHeader: DAEMON_AUTH_NONCE_HEADER,
    websocketQueryParam: DAEMON_AUTH_WEBSOCKET_QUERY_PARAM,
    classifyRequestOrigin,
    applyCorsHeaders,
    handlePreflight,
    handleAuthRoute,
    authorizeHttp,
    authorizeWebSocketUpgrade,
    createNonce
  };
}

export function isCorsManagedRoute(pathname: string): boolean {
  return isAuthRoute(pathname) ||
    pathname === "/providers/dom/snapshot" ||
    pathname === "/providers/screen/snapshot" ||
    pathname.startsWith("/browser-action/") ||
    pathname.startsWith("/semantic-memory/") ||
    pathname.startsWith("/capabilities/") ||
    pathname.startsWith("/storage/") ||
    pathname.startsWith("/computer-use/");
}

function isAuthRoute(pathname: string): boolean {
  return pathname === "/daemon/auth/handshake" || pathname === "/daemon/auth/nonce";
}

function requiresBrowserMutationAuth(originDecision: OriginDecision, method: string, pathname: string): boolean {
  if (originDecision.kind !== "browser") {
    return false;
  }
  if (!isCorsManagedRoute(pathname) || isAuthRoute(pathname)) {
    return false;
  }
  const normalized = normalizeMethod(method);
  return normalized === "POST" || normalized === "PUT" || normalized === "PATCH" || normalized === "DELETE";
}

function classifyOrigin(origin: string | undefined): OriginDecision {
  if (!origin) {
    return { trusted: true, kind: "native" };
  }
  if (origin === "null") {
    return { trusted: false, kind: "browser", origin, reason: "Opaque browser origins are not allowed." };
  }
  if (/^(chrome|edge|moz)-extension:\/\//.test(origin)) {
    return { trusted: true, kind: "extension", origin };
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "tauri:") {
      return { trusted: true, kind: "browser", origin };
    }
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && isTrustedLoopbackHost(parsed.hostname)) {
      return { trusted: true, kind: "browser", origin };
    }
  } catch {
    return { trusted: false, kind: "browser", origin, reason: "Origin is malformed." };
  }
  return { trusted: false, kind: "browser", origin, reason: "Origin is not a trusted local widget origin." };
}

function isTrustedLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost" ||
    normalized === "tauri.localhost";
}

function readHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeMethod(method: string): string {
  return method.trim().toUpperCase();
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function nonceScope(method: string, path: string): string {
  return `${normalizeMethod(method)} ${normalizePath(path)}`;
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function appendVary(current: number | string | string[] | undefined, value: string): string {
  const values = Array.isArray(current)
    ? current.flatMap((entry) => entry.split(","))
    : typeof current === "string"
      ? current.split(",")
      : [];
  const normalized = values.map((entry) => entry.trim()).filter(Boolean);
  if (!normalized.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
    normalized.push(value);
  }
  return normalized.join(", ");
}
