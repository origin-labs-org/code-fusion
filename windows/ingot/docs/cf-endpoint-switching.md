# CodeFusion Endpoint Switching

CodeFusion runtime endpoints are derived from a single origin. Production uses
`https://cf.z.ai`; local development uses `https://cf.z.ai`
through `.env.development`.

The shared resolver exposes these derived URLs:

- API base: `/api/v1`
- CodeFusion Plan OpenAI base: `/api/v1/cf-plan`
- mobile remote entry: `/remote`
- web remote OAuth callback: `/web-remote/callback`
- relay WebSocket: `/ws`, with `https -> wss` and `http -> ws`

`CF_BASE_URL` is the canonical env variable for the origin. Production builds still ignore
settings overrides; the resolver uses `CF_BASE_URL` when present, otherwise falls back to
`https://cf.z.ai`. This prevents a stale local setting from moving release builds to a test or
custom endpoint, while keeping release/test deploy targets explicit in env files.

In non-production desktop builds, the Help menu contains `CodeFusion Endpoint` with these actions:

- `Production (default)` stores the production origin explicitly.
- `Test` stores `https://cf.z.ai`.
- `Custom...` accepts an `http` or `https` origin and normalizes it to `URL.origin`.
- `Reset to Default` clears the override and returns to the env/default origin.

The setting is stored as `cfEndpointOrigin` in app settings and only acts as a non-production
temporary override above `CF_BASE_URL`. Changing it rebuilds the menu and stops active web remote
runtimes so the next connection uses the new relay and remote URL. Existing
HTTP requests are not cancelled; later requests are rewritten by `NodeApiClient` from the production
origin to the active origin, while unrelated domains such as `cdn.cf-ai.com` and
`feedback.example.invalid` are left untouched. Provider API domains are resolved by their own
environment rules; for example BigModel API requests use `https://bigmodel.cn` when
`CF_ENV=test` and `https://bigmodel.cn` in production.

For Web dev server, desktop host services, scripts, and CLI testing, set `CF_BASE_URL`, for
example:

```bash
CF_BASE_URL=https://cf.z.ai pnpm --filter @origin-ai/cf-web dev
CF_BASE_URL=http://localhost:3030 cf auth login
```

`CF_ENDPOINT_ORIGIN` is still read as a compatibility fallback, but new configs should use
`CF_BASE_URL`.

Android release builds only allow `https://cf.z.ai/remote`. Debug builds additionally allow
`https://cf.z.ai/remote` and the existing local/LAN development hosts.
