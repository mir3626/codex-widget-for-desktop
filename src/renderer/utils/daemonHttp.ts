type DaemonAuthHandshake = {
  token: string;
  header: string;
  nonceHeader: string;
  websocketQueryParam: string;
  nonceTtlMs: number;
};

const authCache = new Map<string, Promise<DaemonAuthHandshake | null>>();

export async function readDaemonAuth(daemonPort: string | number): Promise<DaemonAuthHandshake | null> {
  const port = String(daemonPort);
  let cached = authCache.get(port);
  if (!cached) {
    cached = fetchDaemonAuth(port);
    authCache.set(port, cached);
  }
  return await cached;
}

export function clearDaemonAuth(daemonPort: string | number): void {
  authCache.delete(String(daemonPort));
}

export async function daemonFetchJson<T>(daemonPort: string | number, path: string): Promise<T> {
  const response = await fetch(daemonUrl(daemonPort, path));
  const payload = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `${path} returned ${response.status}`);
  }
  return payload as T;
}

export async function daemonPostJson<T>(daemonPort: string | number, path: string, body: unknown): Promise<T> {
  const port = String(daemonPort);
  const auth = await readDaemonAuth(port);
  const headers: Record<string, string> = {
    "content-type": "application/json"
  };
  if (auth) {
    headers[auth.header] = auth.token;
    headers[auth.nonceHeader] = await fetchDaemonNonce(port, auth, "POST", path);
  }

  const response = await fetch(daemonUrl(port, path), {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  if ((response.status === 401 || response.status === 409) && auth) {
    clearDaemonAuth(port);
  }
  const payload = await response.json() as T & { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? `${path} returned ${response.status}`);
  }
  return payload as T;
}

export function daemonWebSocketUrl(daemonPort: string | number, auth: DaemonAuthHandshake | null): string {
  const base = `ws://127.0.0.1:${daemonPort}`;
  return auth
    ? `${base}?${encodeURIComponent(auth.websocketQueryParam)}=${encodeURIComponent(auth.token)}`
    : base;
}

async function fetchDaemonAuth(daemonPort: string): Promise<DaemonAuthHandshake | null> {
  try {
    const response = await fetch(daemonUrl(daemonPort, "/daemon/auth/handshake"));
    if (!response.ok) {
      return null;
    }
    const payload = await response.json() as { ok?: boolean; auth?: Partial<DaemonAuthHandshake> };
    if (
      payload.ok !== true ||
      typeof payload.auth?.token !== "string" ||
      typeof payload.auth.header !== "string" ||
      typeof payload.auth.nonceHeader !== "string" ||
      typeof payload.auth.websocketQueryParam !== "string"
    ) {
      return null;
    }
    return {
      token: payload.auth.token,
      header: payload.auth.header,
      nonceHeader: payload.auth.nonceHeader,
      websocketQueryParam: payload.auth.websocketQueryParam,
      nonceTtlMs: Number(payload.auth.nonceTtlMs ?? 0)
    };
  } catch {
    return null;
  }
}

async function fetchDaemonNonce(
  daemonPort: string,
  auth: DaemonAuthHandshake,
  method: string,
  path: string
): Promise<string> {
  const response = await fetch(
    daemonUrl(daemonPort, `/daemon/auth/nonce?method=${encodeURIComponent(method)}&path=${encodeURIComponent(path)}`),
    { headers: { [auth.header]: auth.token } }
  );
  const payload = await response.json() as { ok?: boolean; auth?: { nonce?: string }; error?: string };
  if (!response.ok || payload.ok !== true || typeof payload.auth?.nonce !== "string") {
    throw new Error(payload.error ?? `Nonce request failed: ${response.status}`);
  }
  return payload.auth.nonce;
}

function daemonUrl(daemonPort: string | number, path: string): string {
  return `http://127.0.0.1:${daemonPort}${path}`;
}
