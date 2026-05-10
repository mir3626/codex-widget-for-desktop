import type { ServerResponse } from "node:http";

export function writeOAuthCallbackResponse(response: ServerResponse, ok: boolean, message: string): void {
  response.writeHead(ok ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Codex Widget OAuth</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; color: #1c2430; }
      main { max-width: 520px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.55; color: #526172; }
    </style>
  </head>
  <body>
    <main>
      <h1>${ok ? "OAuth 연결 완료" : "OAuth 연결 실패"}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`);
}

export function writeOAuthTokenEntryResponse(response: ServerResponse, input: {
  proxyUrl?: string;
  modelLabel?: string;
}): void {
  const proxyUrl = escapeHtml(input.proxyUrl ?? "");
  const modelLabel = escapeHtml(input.modelLabel ?? "oauth-token");

  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>Codex Widget OAuth Token</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; color: #1c2430; background: #f7faf9; }
      main { max-width: 680px; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { line-height: 1.55; color: #526172; }
      label { display: block; margin: 18px 0 7px; font-weight: 650; }
      input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #ccd7d5; border-radius: 8px; padding: 11px 12px; font: inherit; background: #fff; color: #1c2430; }
      textarea { min-height: 130px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
      button { margin-top: 18px; border: 0; border-radius: 8px; padding: 11px 16px; background: #197a68; color: #fff; font: inherit; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>OAuth token 연결</h1>
      <p>토큰과 프록시 주소를 저장하면 위젯이 바로 Bearer token으로 agent proxy에 연결합니다. 저장 값은 이 프로젝트의 gitignored .env에만 기록됩니다.</p>
      <form method="post" action="/oauth/token">
        <label for="proxy_url">Agent proxy URL</label>
        <input id="proxy_url" name="proxy_url" value="${proxyUrl}" placeholder="http://127.0.0.1:8787/agent/stream" required />
        <label for="model_label">Widget label</label>
        <input id="model_label" name="model_label" value="${modelLabel}" />
        <label for="access_token">OAuth access token</label>
        <textarea id="access_token" name="access_token" autocomplete="off" spellcheck="false" required autofocus></textarea>
        <button type="submit">Save token</button>
      </form>
    </main>
  </body>
</html>`);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
