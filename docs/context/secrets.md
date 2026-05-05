# Secrets Context

## Rules

- Never commit `.env`, API keys, OAuth client secrets, tokens, cookies, or browser session data.
- This widget no longer reads an OpenAI API key directly. The default live path delegates to the local Codex CLI, which owns OpenAI/ChatGPT account authentication.
- If a backend proxy calls OpenAI, that proxy owns server-side credentials outside this client.
- OAuth access tokens are kept in daemon memory only. Persist refresh tokens only in OS credential storage or backend storage, not in project files.
- Logs should not print full credentials. Redact tokens before writing daemon or harness logs.

## Current Environment Variables

- `CODEX_WIDGET_PORT`: optional daemon WebSocket port, default `4128`.
- `CODEX_WIDGET_AUTH_MODE`: `codex` for local Codex CLI OpenAI/ChatGPT sign-in, `pkce` for backend OAuth login experiments, or `token` for a local OAuth access token override.
- `CODEX_WIDGET_AUTH_BASE_URL`: optional base URL used to derive default `/oauth/authorize`, `/oauth/token`, and `/agent/stream` routes.
- `CODEX_WIDGET_OAUTH_CLIENT_ID`: OAuth public client ID used by the daemon PKCE flow.
- `CODEX_WIDGET_OAUTH_SCOPE`: optional OAuth scope, default `openid profile email`.
- `CODEX_WIDGET_OAUTH_ACCESS_TOKEN`: optional local-development OAuth access token override. Store only in gitignored `.env` or the shell environment.
- `CODEX_WIDGET_OAUTH_REDIRECT_URI`: optional redirect URI override, default `http://127.0.0.1:<daemon-port>/oauth/callback`.
- `CODEX_WIDGET_OAUTH_AUTHORIZE_URL`: optional explicit authorization URL.
- `CODEX_WIDGET_OAUTH_TOKEN_URL`: optional explicit token URL.
- `CODEX_WIDGET_AGENT_PROXY_URL`: backend streaming proxy endpoint.
- `CODEX_WIDGET_MODEL_LABEL`: optional UI label for the proxy-backed model path.
- `CODEX_WIDGET_MODEL`: optional Codex CLI model override, default `gpt-5.5`.
- `CODEX_WIDGET_REASONING_EFFORT`: optional Codex CLI reasoning effort override, default `medium`.
- `CODEX_WIDGET_CODEX_WORKDIR`: optional working root for widget-launched `codex exec`, default user home.
- `CODEX_WIDGET_CODEX_ADD_DIRS`: optional additional writable directories for widget-launched `codex exec`; separate entries with `;` on Windows or `:` on Unix, with commas also accepted.
- `CODEX_WIDGET_CODEX_SANDBOX`: optional Codex CLI sandbox for widget-launched sessions, default `danger-full-access`; only `workspace-write` and `danger-full-access` are accepted.

## Auth Direction

Use OAuth for user identity and a backend/proxy for model access. Realtime client sessions may use short-lived ephemeral tokens, but those tokens still need to be minted by a trusted server-side component.

The bundled `scripts/dev-auth-proxy.mjs` is local-development only. It issues short-lived local tokens for widget testing and must not be treated as production identity or model access control.
