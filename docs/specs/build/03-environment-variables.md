# 3. Environment Variables

## Overview

Environment variables configure the JS bundle and native build at compile time. better-update stores them per-project per-environment on the server. The CLI pulls and exports them before each local build.

## Visibility Tiers

| Tier          | Dashboard         | CLI pull | Build logs   | Storage        |
| ------------- | ----------------- | -------- | ------------ | -------------- |
| **Plaintext** | Visible           | Visible  | Visible      | D1 (raw value) |
| **Sensitive** | Masked (`••••••`) | Visible  | Masked       | D1 (encrypted) |
| **Secret**    | Key name only     | Visible  | Never logged | D1 (encrypted) |

All tiers are available to the build process — visibility only controls who can read the value in the dashboard and logs.

### Encryption

- **Plaintext**: stored as-is in D1 `env_vars.value`
- **Sensitive**: encrypted with org KEK (same `VAULT_SECRET`-derived KEK as credentials), stored in D1 `env_vars.encrypted_value`
- **Secret**: same encryption as sensitive, stored in D1 `env_vars.encrypted_value`. The only difference is dashboard visibility (key name only, value never shown).

All env var values are stored in D1 — R2 is reserved for large binary blobs (credentials, artifacts). Env var values are small strings (max 32 KB) and fit comfortably in D1 rows.

## Environments

Each project has named environments mapping to build profiles:

| Environment   | Typical use                         |
| ------------- | ----------------------------------- |
| `development` | Local dev, debug builds             |
| `preview`     | Internal testing, ad-hoc/TestFlight |
| `production`  | App Store / Play Store release      |

Custom environments supported. Variables can be shared across environments by setting `environment: "*"`.

## Injection Points

The CLI exports all variables as shell environment variables before running `expo prebuild` and the native build.

### Metro Bundler (JS bundle)

Variables with `EXPO_PUBLIC_` prefix are inlined into the JS bundle by Metro:

```bash
export EXPO_PUBLIC_API_URL=https://api.example.com
```

Accessible in app code via `process.env.EXPO_PUBLIC_API_URL`.

### Native Build

Non-prefixed variables are available to:

- `app.config.js` / `app.config.ts` (dynamic Expo config reads `process.env`)
- Gradle build scripts via `System.getenv()`

```bash
export APP_VARIANT=production
export SENTRY_AUTH_TOKEN=xxx   # Used by build plugins, not in JS bundle
```

## CLI Flow

```
$ better-update build --platform ios --profile production

  Pulling environment variables for "production"...
  ✓ 5 variables exported

  EXPO_PUBLIC_API_URL=https://api.example.com
  EXPO_PUBLIC_SENTRY_DSN=https://***@sentry.io/123    (sensitive)
  SENTRY_AUTH_TOKEN=***                                (secret)
  APP_VARIANT=production
  ENABLE_ANALYTICS=true
```

The CLI:

1. `GET /api/env-vars/export?projectId=X&environment=production` — **API key auth only** (`Authorization: Bearer bu_...`). Session/cookie auth is rejected to prevent browser-side exfiltration of secrets. Response includes `Cache-Control: no-store`.
2. The server merges `environment: "*"` (shared) variables automatically, with environment-specific values taking precedence
3. CLI exports each as `export KEY=VALUE` in the build subprocess
4. Sensitive/secret values shown masked in CLI output but exported with real values

## Validation Rules

| Rule                                             | Reason                          |
| ------------------------------------------------ | ------------------------------- |
| Key must match `^[A-Z][A-Z0-9_]*$`               | Shell-safe, conventional        |
| Key cannot be `PATH`, `HOME`, `USER`, `SHELL`    | Overriding breaks the build env |
| Max key length: 256 chars                        | Practical limit                 |
| Max value length: 32 KB                          | D1 row size consideration       |
| Max vars per project+environment: 100            | Prevent abuse                   |
| Unique constraint on (project, environment, key) | No duplicates                   |

## Dashboard UI

Environment variables page per project:

- Tab selector for environments (development, preview, production, custom)
- Table: key, value (masked for sensitive, hidden for secret), visibility badge, actions
- Inline edit for value and visibility
- Bulk import from `.env` file upload
- Bulk export to `.env` file download (**plaintext-tier variables only** — sensitive and secret values are excluded since the dashboard does not have access to decrypted values; use CLI `better-update env export` for full export)
- Add variable dialog with visibility selector
