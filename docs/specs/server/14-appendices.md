# Appendices

## Appendix A: Limits & Scaling Considerations

### D1 Limits

| Resource               | Limit | Impact                                                  |
| ---------------------- | ----- | ------------------------------------------------------- |
| Database size          | 10 GB | Sufficient for metadata. Monitor with many projects.    |
| Row/BLOB size          | 2 MB  | No issue — metadata only, no binary blobs.              |
| Queries per invocation | 1,000 | Manifest serving uses 1-3 queries. Publishing uses 2-5. |
| Query duration         | 30s   | Simple indexed queries complete in < 5ms.               |

### R2 Limits

| Resource      | Limit         | Impact                                      |
| ------------- | ------------- | ------------------------------------------- |
| Object size   | 5 TB          | JS bundles are typically < 10 MB. No issue. |
| Egress cost   | $0 (free)     | Major cost advantage over S3/GCS.           |
| Class B reads | $0.36/million | Low cost for asset serving.                 |

### KV Limits

| Resource                  | Limit     | Impact                                     |
| ------------------------- | --------- | ------------------------------------------ |
| Value size                | 25 MiB    | Manifests are typically < 10 KB. No issue. |
| Write rate per key        | 1/second  | Publish invalidation is infrequent.        |
| Propagation delay         | up to 60s | Acceptable for OTA updates.                |
| Operations per invocation | 1,000     | Manifest serving uses 1-2 KV reads.        |

### Durable Object Limits

| Resource            | Limit      | Impact                                          |
| ------------------- | ---------- | ----------------------------------------------- |
| Requests per second | ~500-1,000 | Only used for publishes, not reads. Sufficient. |
| Storage per DO      | 10 GB      | DO stores no persistent state (uses D1).        |

### Scaling Strategy

For most deployments (< 10,000 apps, < 100 updates/day), a single D1 database is sufficient. For larger scale:

1. **Shard D1 by project:** Each project (or group of projects) gets its own D1 database. The Worker routes queries based on project ID. Note: a single Worker can bind up to ~5,000 D1 databases, so this approach scales to thousands of projects. Beyond that, multiple Workers with different binding sets are needed.
2. **R2 is already global:** No sharding needed. Content-addressed deduplication reduces storage naturally.
3. **KV scales automatically:** No sharding needed.
4. **DO per branch:** Already sharded by design (one DO per branch).

---

## Appendix B: Comparison with EAS Update

| Feature                   | EAS Update             | better-update                                       |
| ------------------------- | ---------------------- | --------------------------------------------------- |
| Manifest serving          | GraphQL + CDN          | Worker + Cache API + D1                             |
| Asset hosting             | AWS S3 + CloudFront    | R2 public bucket + CDN (zero egress, zero Worker)   |
| Publish API               | GraphQL mutations      | REST API                                            |
| Channel/branch management | GraphQL + EAS CLI      | REST API + Dashboard                                |
| Code signing              | Server-side + client   | Publisher signs everything (manifests + directives) |
| Rollbacks                 | GraphQL mutations      | REST API (publisher-constructed directives)         |
| Delta updates (bsdiff)    | Supported (SDK 55+)    | Supported (Phase 7, pre-computed at publish time)   |
| Gradual rollouts          | Supported (percentage) | Supported (Phase 6, branch-based)                   |
| Cache invalidation        | Internal               | Cloudflare Cache Purge API (~150ms global)          |
| Update groups             | Automatic              | Manual (groupId in publish)                         |
| Multi-org / multi-project | Built-in               | Supported via projects table                        |
| Pricing                   | Per-update-user/month  | Cloudflare usage-based (~$11/month @ 1M DAU)        |
