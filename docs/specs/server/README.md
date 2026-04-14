# Cloudflare Implementation Specification

Implementation spec for `better-update` — a self-hosted EAS Update server on Cloudflare.

---

## Table of Contents

1. [Architecture](./01-architecture.md) — System overview, cost optimization, service mapping
2. [Data Model](./02-data-model.md) — D1 schema, indexes, design decisions
3. [API Endpoints](./03-api-endpoints.md) — Protocol & management endpoints, authentication
4. [Manifest Serving](./04-manifest-serving.md) — Hot path, resolution algorithm, response format
5. [Asset Serving](./05-asset-serving.md) — R2 public bucket, compression, CDN caching
6. [Publishing](./06-publishing.md) — Two-phase publish flow, Durable Object coordination, deduplication
7. [Channels & Branches](./07-channels-branches.md) — CRUD operations, auto-creation
8. [Code Signing](./08-code-signing.md) — Publisher-signs-everything model, multipart structure
9. [Rollbacks](./09-rollbacks.md) — Republish & rollback-to-embedded flows
10. [Caching](./10-caching.md) — Two-layer cache strategy, cache purge on publish
11. [Configuration](./11-configuration.md) — Wrangler bindings, secrets
12. [Gradual Rollouts](./12-gradual-rollouts.md) — BranchMapping, hash_lt, caching impact
13. [Implementation Plan](./13-implementation-plan.md) — Phased delivery roadmap
14. [Appendices](./14-appendices.md) — Limits & scaling, comparison with EAS Update
15. [Management Extensions](./15-management-extensions.md) — Channel pause/resume, branch rename, update deletion
16. [Cross-Channel Republish](./16-cross-channel-republish.md) — Promote updates across channels/branches
17. [Per-Update Rollouts](./17-per-update-rollouts.md) — Percentage-based rollout per individual update
18. [Deployment Analytics](./18-deployment-analytics.md) — WAE-based adoption tracking & dashboard metrics
19. [Delta Patch Flags](./19-bundle-diffing.md) — Self-hosted server ignores bsdiff patch hints
20. [Extra Params](./20-extra-params.md) — Custom client targeting headers & analytics integration
21. [Authentication](./21-authentication.md) — Better Auth integration, multi-org, RBAC, API keys
