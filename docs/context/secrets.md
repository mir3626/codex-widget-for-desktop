# Secrets Context

## Rules

- Never commit `.env`, API keys, OAuth client secrets, tokens, cookies, or browser session data.
- `OPENAI_API_KEY` may be used only by the local daemon or a future backend, never by renderer code.
- OAuth access/refresh tokens for future user login must be stored in OS credential storage or backend storage, not in project files.
- Logs should not print full credentials. Redact tokens before writing daemon or harness logs.

## Current Environment Variables

- `OPENAI_API_KEY`: optional, used by the daemon for OpenAI Responses API calls.
- `OPENAI_MODEL`: optional model override.
- `CODEX_WIDGET_PORT`: optional daemon WebSocket port, default `4128`.

## Future Auth Direction

Use OAuth for user identity and a backend/proxy for OpenAI API access. Realtime client sessions may use short-lived ephemeral tokens, but those tokens still need to be minted by a trusted server-side component.
