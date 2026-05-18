import type { IncomingMessage, Server, ServerResponse } from "node:http";

export async function readRequestBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function writeJsonResponse(response: ServerResponse, status: number, body: unknown): void {
  response
    .writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      ...readResponseCorsHeaders(response)
    })
    .end(JSON.stringify(body));
}

export function readResponseCorsHeaders(response: ServerResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
    "Vary"
  ]) {
    const value = response.getHeader(name);
    if (value === undefined) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return headers;
}

export function getServerPort(server: Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    return 0;
  }
  return address.port;
}
