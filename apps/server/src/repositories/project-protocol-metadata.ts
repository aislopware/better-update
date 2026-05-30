import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";

// Per-(project, scopeKey) protocol metadata the device persists in its local
// SQLite json_data store: expo-server-defined-headers today and (P1)
// expo-manifest-filters. Keyed by the compound (project_id, scope_key) tenant
// key so the same origin hosting many projects never bleeds project B's stored
// protocol state into project A. scope_key is derived server-side via
// domain/scope-key.ts to match what each installed app computes.

export interface ProjectProtocolMetadataRow {
  server_defined_headers_json: string | null;
  manifest_filters_json: string | null;
  updated_at: string;
}

export interface ProjectProtocolMetadataRepository {
  readonly get: (params: {
    readonly projectId: string;
    readonly scopeKey: string;
  }) => Effect.Effect<ProjectProtocolMetadataRow | null>;

  readonly upsertServerDefinedHeaders: (params: {
    readonly projectId: string;
    readonly scopeKey: string;
    readonly serverDefinedHeadersJson: string | null;
  }) => Effect.Effect<void>;

  // P1 emission writes manifest filters through the identical ON CONFLICT shape.
  // Defined now so the P1 selection-policy cluster has the port ready.
  readonly upsertManifestFilters: (params: {
    readonly projectId: string;
    readonly scopeKey: string;
    readonly manifestFiltersJson: string | null;
  }) => Effect.Effect<void>;
}

export class ProjectProtocolMetadataRepo extends Context.Tag("api/ProjectProtocolMetadataRepo")<
  ProjectProtocolMetadataRepo,
  ProjectProtocolMetadataRepository
>() {}

const SELECT_COLUMNS = `"server_defined_headers_json", "manifest_filters_json", "updated_at"`;

export const ProjectProtocolMetadataRepoLive = Layer.succeed(ProjectProtocolMetadataRepo, {
  get: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      return yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${SELECT_COLUMNS} FROM "project_protocol_metadata" WHERE "project_id" = ? AND "scope_key" = ?`,
        )
          .bind(params.projectId, params.scopeKey)
          .first<ProjectProtocolMetadataRow>(),
      );
    }),

  upsertServerDefinedHeaders: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "project_protocol_metadata" ("project_id", "scope_key", "server_defined_headers_json") VALUES (?, ?, ?) ON CONFLICT("project_id", "scope_key") DO UPDATE SET "server_defined_headers_json" = excluded."server_defined_headers_json", "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
          .bind(params.projectId, params.scopeKey, params.serverDefinedHeadersJson)
          .run(),
      );
    }),

  upsertManifestFilters: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      yield* Effect.promise(async () =>
        env.DB.prepare(
          `INSERT INTO "project_protocol_metadata" ("project_id", "scope_key", "manifest_filters_json") VALUES (?, ?, ?) ON CONFLICT("project_id", "scope_key") DO UPDATE SET "manifest_filters_json" = excluded."manifest_filters_json", "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
          .bind(params.projectId, params.scopeKey, params.manifestFiltersJson)
          .run(),
      );
    }),
});
