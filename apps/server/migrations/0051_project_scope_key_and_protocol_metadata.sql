-- scopeKey = the per-app origin identity the device uses to partition its local
-- protocol metadata store (expo-server-defined-headers now, expo-manifest-filters
-- in P1). The server derives the SAME string via src/domain/scope-key.ts so
-- per-(project, scopeKey) state and the manifest cache line up with each
-- installed app. For better-update served projects this is
-- normalizedURLOrigin(PUBLIC_API_URL); a project on a custom update domain may
-- carry a different origin here.
--
-- scope_key is the DEVICE-ORIGIN scopeKey, NOT an EAS-style per-project
-- `@owner/slug` identity. The expo-updates v1 scopeKey is INTENTIONALLY SHARED
-- across every project served from the same origin (see src/domain/scope-key.ts
-- and its test): two projects on one baseUrl derive the identical scopeKey. So
-- this column is deliberately NON-UNIQUE — a UNIQUE index would reject the
-- second project that shares an origin. Tenant isolation is provided by the
-- compound (project_id, scope_key) key on project_protocol_metadata and by
-- including scope_key in the manifest cache key, not by uniqueness here.
--
-- Kept nullable so the ALTER is non-destructive on existing rows -- NOT NULL
-- would fail against the 0002 baseline. PUBLIC_API_URL differs per environment
-- (prod vs local vs dev) and a static migration cannot read it, so legacy rows
-- stay NULL here. The manifest handler derives a fallback scopeKey from the live
-- PUBLIC_API_URL origin for NULL rows (see handlers/manifest.ts), so a NULL
-- scope_key never breaks serving; an explicit value is only needed when a
-- project's update origin differs from PUBLIC_API_URL.
ALTER TABLE "projects" ADD COLUMN "scope_key" TEXT;

-- Non-unique lookup index. scope_key is a shared device origin, so multiple
-- projects legitimately carry the same value; the index speeds origin-based
-- lookups without imposing a uniqueness rule the concept does not support.
CREATE INDEX "idx_projects_scope_key" ON "projects"("scope_key") WHERE "scope_key" IS NOT NULL;

-- Per-(project, scopeKey) protocol metadata. Sized so the P1 manifest-filters
-- emission slots in as a sibling column with no further migration: P1 only
-- writes manifest_filters_json. Both json columns are nullable so a field can be
-- cleared (expo-updates v1 full-replace/clear semantics). The (project_id,
-- scope_key) compound PK guarantees exactly one row per tenant.
CREATE TABLE "project_protocol_metadata" (
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "scope_key" TEXT NOT NULL,
  "server_defined_headers_json" TEXT,
  "manifest_filters_json" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY ("project_id", "scope_key")
);
