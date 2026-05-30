# 4. Data Model (D1)

## Schema

```mermaid
erDiagram
    projects ||--o{ branches : has
    projects ||--o{ channels : has
    branches ||--o{ updates : contains
    branches ||--o{ channels : "linked via branch_id"
    updates ||--o{ update_assets : has
    assets ||--o{ update_assets : "referenced by"

    projects {
        TEXT id PK "UUIDv7"
        TEXT organization_id FK "owns this project"
        TEXT name
        TEXT scope_key "device-origin scopeKey, nullable, NON-unique (shared across projects on one origin)"
        TEXT created_at "ISO 8601"
    }

    branches {
        TEXT id PK "UUIDv7"
        TEXT project_id FK
        TEXT name "UK(project_id, name)"
        TEXT created_at
    }

    channels {
        TEXT id PK "UUIDv7"
        TEXT project_id FK
        TEXT name "UK(project_id, name)"
        TEXT branch_id FK "must belong to same project"
        TEXT branch_mapping_json "JSON expression tree for rollout"
        INTEGER cache_version "monotonic counter, DEFAULT 0"
        INTEGER is_paused "0 or 1, DEFAULT 0"
        TEXT created_at
    }

    updates {
        TEXT id PK "UUIDv7 = manifest id"
        TEXT branch_id FK
        TEXT runtime_version
        TEXT platform "CHECK: ios | android"
        TEXT message "publish message"
        TEXT metadata_json "default: {}"
        TEXT extra_json "nullable"
        TEXT group_id "links iOS+Android"
        INTEGER rollout_percentage "0-100, DEFAULT 100"
        INTEGER is_rollback "0 or 1"
        TEXT signature "base64 RSA-SHA256"
        TEXT certificate_chain "PEM"
        TEXT manifest_body "nullable, verbatim signed JSON"
        TEXT directive_body "nullable, verbatim signed JSON"
        TEXT created_at "ISO 8601"
    }

    assets {
        TEXT hash PK "base64url SHA-256"
        TEXT content_type
        TEXT file_ext "e.g. .png, .js"
        INTEGER byte_size
        TEXT r2_key "R2 object key"
        TEXT created_at
    }

    update_assets {
        TEXT update_id PK,FK
        TEXT asset_key PK "e.g. bundle, logo"
        TEXT asset_hash FK
        INTEGER is_launch "partial UK: max 1 per update"
    }
```

## Indexes

| Index                         | Columns                                                            | Purpose                                     |
| ----------------------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `idx_projects_scope_key`      | `scope_key` (non-unique, partial `WHERE scope_key IS NOT NULL`)    | Lookup project by device-origin scopeKey    |
| `idx_branches_project_name`   | `(project_id, name)` UNIQUE                                        | Lookup branch by project + name             |
| `idx_channels_project_name`   | `(project_id, name)` UNIQUE                                        | Lookup channel by project + name            |
| `idx_updates_resolution`      | `(branch_id, platform, runtime_version, created_at DESC, id DESC)` | **Critical** — manifest resolution query    |
| `idx_updates_group`           | `group_id`                                                         | Dashboard: find paired iOS/Android updates  |
| `idx_update_assets_update`    | `update_id`                                                        | Join assets for a given update              |
| `idx_update_assets_launch`    | `update_id` WHERE `is_launch = 1` UNIQUE                           | Enforce exactly one launch asset per update |
| `idx_channels_branch_project` | `(branch_id, project_id)`                                          | Enforce channel→branch same-project         |
| `idx_projects_org`            | `organization_id`                                                  | List projects by organization               |

## Key Design Decisions

**UUIDv7 for IDs:** Monotonically increasing, sortable by time, globally unique. Suitable for distributed generation without coordination.

**Content-addressed assets:** The `assets` table is keyed by SHA-256 hash. Identical assets across updates are stored once in R2. The `update_assets` junction table maps updates to their assets.

**`is_rollback` flag:** Instead of a separate directives table, rollback directives are modeled as updates with `is_rollback = 1`. This simplifies the resolution query — the latest entry on a branch determines the response type (manifest vs directive). Following the EAS CLI model, the publisher pre-signs both manifests and directives before uploading — the server stores and forwards signatures without signing anything itself.

**`group_id`:** Links iOS and Android updates published together. Used by the dashboard to display update groups.

**`organization_id` on projects:** All projects belong to exactly one organization. Organization-scoped access control ensures management API requests can only access projects within the caller's organization (see [spec 21](./21-authentication.md)).

**`scope_key` on projects:** The expo-updates v1 **device-origin scopeKey** — `normalizedURLOrigin(updateUrl)` — that each installed app uses to partition its local protocol-metadata store (`expo-server-defined-headers`, and `expo-manifest-filters` in the selection-policy work). The server reproduces the same string via `src/domain/scope-key.ts` so per-(project, scopeKey) state and the manifest cache key line up with what the device computes. This is **not** an EAS-style per-project `@owner/slug` identity: because it is an _origin_, it is **intentionally shared** across every project served from the same `PUBLIC_API_URL`, so the column is **non-unique**. The value is nullable; for NULL (legacy) rows the manifest handler falls back to `normalizedURLOrigin(PUBLIC_API_URL)` at request time, so an explicit value is only needed when a project's update origin differs from `PUBLIC_API_URL` (e.g. a custom domain). Tenant isolation comes from the compound `(project_id, scope_key)` key on `project_protocol_metadata` and from including `scope_key` in the manifest cache key — never from uniqueness on this column.

**`cache_version` on channels:** A monotonic integer counter bumped atomically with any state change that affects manifest responses (publish, relink, rollout change, pause/resume, update deletion). Included in the Cache API cache key to ensure stale entries are never matched — cache purge becomes a cleanup optimization, not a correctness requirement. See [spec 10](./10-caching.md).

**`is_paused` on channels:** When set to `1`, the manifest endpoint returns `204 No Content` for all requests to this channel. See [spec 15](./15-management-extensions.md).

**`rollout_percentage` on updates:** Controls per-update gradual rollouts. `100` = fully available (default). `1`-`99` = partial rollout. `0` = reverted (skipped in resolution — all devices receive the previous update). See [spec 17](./17-per-update-rollouts.md).

**No `status` column:** All updates are active. Rollbacks are modeled by publishing a new entry (either a new update or a rollback directive). The latest entry always wins.

**`branch_mapping_json` on channels:** Encodes gradual rollout logic as a JSON expression tree (matching EAS Update's `branchMapping` format). When set, overrides `branch_id` for manifest resolution. When `NULL`, the simple `branch_id` mapping applies.

**`signature` + `certificate_chain` on updates:** Stored inline rather than in a separate table. Both manifest signatures and directive signatures are provided by the publisher at publish time and served as-is.

**`manifest_body` + `directive_body` on updates:** When code signing is active, the publisher constructs and signs the full manifest/directive JSON before uploading. The server stores this verbatim in `manifest_body` (for normal updates) or `directive_body` (for rollback directives) and serves it as-is to preserve the publisher's signature. When signing is not active, these columns are `NULL` and the server constructs the manifest at serve time from relational data.

**`PRIMARY KEY (update_id, asset_key)` on update_assets:** Ensures each logical asset key (e.g., "bundle", "logo") appears at most once per update. The partial unique index `idx_update_assets_launch` enforces exactly one launch asset per update.

Note: This index enforces **at most** one launch asset per update. The publish endpoint must additionally validate **exactly one** launch asset for normal updates, and **zero** assets for rollback directives.

## Indexes Explained

**`idx_updates_resolution`** — the critical index for manifest serving. Resolves "latest update for branch X, platform Y, runtime version Z" in a single indexed query. `ORDER BY created_at DESC, id DESC` breaks ties when `created_at` is identical (UUIDv7 is monotonic). This single query handles the entire channel→branch→update resolution after the channel lookup.
