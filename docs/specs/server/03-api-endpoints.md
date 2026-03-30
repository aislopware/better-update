# 5. API Endpoints

## Protocol Endpoints (expo-updates client facing)

| Method | Path                   | Purpose                         | Auth   |
| ------ | ---------------------- | ------------------------------- | ------ |
| GET    | `/manifest/:projectId` | Serve update manifest/directive | None   |
| GET    | `/assets/:hash`        | Serve asset by content hash     | None\* |

The client's `updates.url` in `app.json` must include the project ID: `https://api.updates.example.com/manifest/<projectId>`. This is required because the protocol sends routing info (platform, runtime version, channel) via headers, not URL params. The project ID in the path is the only way to identify which project a request targets.

\*Asset requests may include `assetRequestHeaders` from extensions. Note: `assetRequestHeaders` do NOT enforce auth on the R2 public bucket — they are only passed by the client. If private assets are required, assets must be served through the Worker instead of the R2 public bucket.

## Management API (publisher/dashboard facing)

| Method | Path                                 | Purpose                                    | Auth    |
| ------ | ------------------------------------ | ------------------------------------------ | ------- |
| POST   | `/api/projects`                      | Create project                             | API key |
| GET    | `/api/projects`                      | List projects                              | API key |
| POST   | `/api/branches`                      | Create branch                              | API key |
| GET    | `/api/branches`                      | List branches for project                  | API key |
| PATCH  | `/api/branches/:id`                  | Rename branch                              | API key |
| POST   | `/api/channels`                      | Create channel                             | API key |
| PATCH  | `/api/channels/:id`                  | Update channel (relink branch)             | API key |
| GET    | `/api/channels`                      | List channels for project                  | API key |
| POST   | `/api/channels/:id/pause`            | Pause channel                              | API key |
| POST   | `/api/channels/:id/resume`           | Resume channel                             | API key |
| POST   | `/api/assets/upload`                 | Upload asset(s) to R2                      | API key |
| POST   | `/api/updates`                       | Publish update (manifest + directive)      | API key |
| GET    | `/api/updates`                       | List updates                               | API key |
| DELETE | `/api/updates/:groupId`              | Delete update group                        | API key |
| POST   | `/api/updates/republish`             | Cross-channel republish (promote)          | API key |
| PATCH  | `/api/updates/:id/rollout`           | Edit per-update rollout percentage         | API key |
| POST   | `/api/updates/:id/rollout/complete`  | End rollout — make update available to all | API key |
| POST   | `/api/updates/:id/rollout/revert`    | End rollout — revert to previous update    | API key |
| POST   | `/api/channels/:id/rollout`          | Create branch-based rollout                | API key |
| PATCH  | `/api/channels/:id/rollout`          | Edit branch-based rollout percentage       | API key |
| POST   | `/api/channels/:id/rollout/complete` | End rollout — promote new branch           | API key |
| POST   | `/api/channels/:id/rollout/revert`   | End rollout — revert to original branch    | API key |
| GET    | `/api/analytics/adoption`            | Adoption rate per update                   | API key |
| GET    | `/api/analytics/updates`             | Download/apply counts for an update        | API key |
| GET    | `/api/analytics/channels`            | Channel-level metrics                      | API key |
| GET    | `/api/analytics/platforms`           | Platform split breakdown                   | API key |

## Authentication

Management API supports two authentication methods (see [spec 21](./21-authentication.md)):

| Method             | Header                                  | Use case            |
| ------------------ | --------------------------------------- | ------------------- |
| **Session cookie** | `cookie: better-auth.session_token=...` | Dashboard (browser) |
| **API key**        | `Authorization: Bearer bu_...`          | CLI / CI pipelines  |

Both methods resolve to an organization context. All management API requests require an active organization — requests without one return `400 Bad Request`. The middleware enforces that the target resource (project, channel, branch, update) belongs to the caller's organization.

Protocol endpoints (`/manifest/:projectId`, `/assets/*`) are unauthenticated — the expo-updates client does not send auth headers by default. Rate limiting should be applied to prevent abuse (see [Caching](./10-caching.md)).
