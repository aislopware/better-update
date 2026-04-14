# 16. Implementation Plan

Implementation order based on dependency graph — each group builds on the previous.

## 1. Data Layer + Manifest Serving

**Goal:** An expo-updates client can check for and receive updates from the server.

| Task                                                                                                                          | Cloudflare Service |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| D1 schema (all tables + indexes)                                                                                              | D1                 |
| `GET /manifest/:projectId` — full protocol v1 compliance (header validation, Accept negotiation, `204`/`406`, common headers) | Worker             |
| Manifest builder (launchAsset + assets array)                                                                                 | Worker             |
| Multipart response encoding (RFC 2046)                                                                                        | Worker             |
| Schema includes `manifest_body`, `directive_body`, `signature`, `certificate_chain` columns                                   | D1                 |
| Manifest serving: serve from `manifest_body` when present, construct from relational data when NULL                           | Worker             |
| R2 public bucket setup with custom domain for assets                                                                          | R2                 |
| Seed data + integration test: expo-updates client fetches manifest + assets                                                   | D1 + E2E           |

**Deliverable:** Protocol-compliant manifest + asset serving. Assets from R2 public bucket (zero Worker cost).

## 2. Publishing + Caching

**Goal:** Updates can be published via API with cache optimization.

| Task                                                                                       | Cloudflare Service |
| ------------------------------------------------------------------------------------------ | ------------------ |
| Asset upload with deduplication                                                            | Worker + R2 + D1   |
| Update publishing (create record, link assets)                                             | Worker + D1        |
| Accept `manifestBody`, `directiveBody`, `signature`, `certificateChain` in publish request | Worker + D1        |
| Publish serialization per branch                                                           | DO                 |
| API key authentication                                                                     | Worker             |
| Manifest response caching (composite key)                                                  | Worker (Cache API) |
| Channel→branch mapping cache                                                               | KV                 |
| Global cache purge on publish (with retry)                                                 | Worker (Purge API) |

**Deliverable:** Full publish → serve flow with optimized caching.

## 3. Channel & Branch Management

**Goal:** Full lifecycle management of channels, branches, and projects.

| Task                                          | Cloudflare Service |
| --------------------------------------------- | ------------------ |
| Project CRUD                                  | Worker + D1        |
| Branch CRUD (including rename)                | Worker + D1        |
| Channel CRUD (create, list, relink)           | Worker + D1        |
| Channel pause/resume                          | Worker + D1 + KV   |
| Auto-create branch + channel on first publish | Worker + D1        |
| Cache invalidation on channel relink          | Worker (Purge API) |

**Deliverable:** Complete management API.

## 4. Rollbacks

**Goal:** Both rollback mechanisms are supported.

| Task                                                                  | Cloudflare Service |
| --------------------------------------------------------------------- | ------------------ |
| Republish flow (re-publish existing assets as new update)             | Worker + D1 + DO   |
| Cross-channel republish (promote)                                     | Worker + D1 + DO   |
| Rollback directive flow (publisher submits pre-constructed directive) | Worker + D1 + DO   |
| Serve stored directive verbatim when `is_rollback` detected           | Worker             |
| Update deletion (by group)                                            | Worker + D1        |

**Deliverable:** Full rollback + republish + deletion support.

## 5. Code Signing

**Goal:** Publisher-signed updates and directives are stored and served correctly.

| Task                                                                | Cloudflare Service |
| ------------------------------------------------------------------- | ------------------ |
| Validate `expo-expect-signature` request header behavior            | Worker             |
| Include `certificate_chain` multipart part in signed responses      | Worker             |
| E2E test: publish signed update → fetch manifest → verify signature | E2E                |

**Deliverable:** Verified end-to-end code signing (prerequisites in Phase 1/2, integration validated here).

## 6. Rollouts

**Goal:** Percentage-based rollouts at both channel and update level.

| Task                                                | Cloudflare Service |
| --------------------------------------------------- | ------------------ |
| BranchMapping expression tree evaluator (`hash_lt`) | Worker             |
| Branch-based rollout: manifest resolution           | Worker             |
| Per-update rollout: update resolution with fallback | Worker             |
| Two-layer rollout interaction (branch + update)     | Worker             |
| Cache key with resolved branch + update ID          | Worker             |
| Rollout API (create, edit percentage, end)          | Worker + D1        |
| Cache purge on rollout change                       | Worker (Purge API) |

**Deliverable:** Branch-based and per-update gradual rollouts.

## 7. Authentication & Authorization

**Goal:** Multi-org auth with session-based dashboard access and org-scoped API keys.

| Task                                                            | Cloudflare Service |
| --------------------------------------------------------------- | ------------------ |
| Better Auth setup with D1 + KV session storage                  | Worker + D1 + KV   |
| Mount `/api/auth/*` endpoints                                   | Worker             |
| Organization plugin (create, invite, roles)                     | Worker + D1        |
| API key plugin (org-scoped keys with `bu_` prefix)              | Worker + D1        |
| Auth middleware (session + API key → org context)               | Worker             |
| Add `organization_id` to projects + backfill migration          | D1                 |
| Permission enforcement on all management API endpoints          | Worker             |
| Organization ownership validation (cross-org access prevention) | Worker + D1        |
| Deprecate and remove global `API_KEY` Worker secret             | Worker             |

**Deliverable:** Full multi-org auth with session and API key support.

## 8. Delta Patch Support

**Decision:** Not planned for the self-hosted server.

Client-side flags such as `enableBsdiffPatchSupport` may still be present in Expo
configuration, but the server ignores those hints and always serves standard full-asset
manifests.

**Deliverable:** No delta patch support. Full-asset delivery remains the only supported
update path.

## 9. Analytics + Dashboard

**Goal:** Deployment analytics and web dashboard for managing updates.

| Task                                                 | Cloudflare Service |
| ---------------------------------------------------- | ------------------ |
| WAE event tracking (manifest request events)         | Analytics Engine   |
| Analytics API endpoints (adoption, channels, etc.)   | Worker + WAE       |
| Dashboard: sign-up/sign-in pages                     | —                  |
| Dashboard: organization switcher + member management | —                  |
| Dashboard: API key management UI                     | —                  |
| Dashboard: projects, channels, branches, updates     | —                  |
| Dashboard: rollback + rollout management UI          | —                  |
| Dashboard: update group visualization (iOS+Android)  | —                  |
| Dashboard: analytics charts                          | —                  |

**Deliverable:** Production-ready analytics + dashboard with auth.

## Dependency Notes

- **Signed mode prerequisites** (schema columns, publish API fields, verbatim serving) are included in Phases 1-2 to avoid schema migration later. Phase 5 validates the end-to-end flow.
- **Cache version token** is included in Phase 2 (caching) to ensure correctness from the start. The Cloudflare Purge API is optional cleanup.
- **Per-update rollouts** (Phase 6) depend on Phase 2 (caching) for the extended cache key with `resolvedUpdateId`.
- **Authentication** (Phase 7) is placed after core functionality (Phases 1-6) to avoid blocking protocol development. Phases 1-6 use a temporary global API key; Phase 7 replaces it with org-scoped auth.
- **Dashboard** (Phase 9) depends on Phase 7 (auth) for sign-in, organization context, and API key management UI.
