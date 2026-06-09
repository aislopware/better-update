import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";
import { sql } from "kysely";

import { kyselyDb } from "../cloudflare/db";

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

const COLUMNS = ["server_defined_headers_json", "manifest_filters_json", "updated_at"] as const;

export const ProjectProtocolMetadataRepoLive = Layer.succeed(ProjectProtocolMetadataRepo, {
  get: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("project_protocol_metadata")
          .select(COLUMNS)
          .where("project_id", "=", params.projectId)
          .where("scope_key", "=", params.scopeKey)
          .executeTakeFirst(),
      );
      return toDbNull(row);
    }),

  upsertServerDefinedHeaders: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("project_protocol_metadata")
          .values({
            project_id: params.projectId,
            scope_key: params.scopeKey,
            server_defined_headers_json: params.serverDefinedHeadersJson,
          })
          .onConflict((oc) =>
            oc.columns(["project_id", "scope_key"]).doUpdateSet((eb) => ({
              server_defined_headers_json: eb.ref("excluded.server_defined_headers_json"),
              updated_at: sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
            })),
          )
          .execute(),
      );
    }),

  upsertManifestFilters: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      yield* Effect.promise(async () =>
        db
          .insertInto("project_protocol_metadata")
          .values({
            project_id: params.projectId,
            scope_key: params.scopeKey,
            manifest_filters_json: params.manifestFiltersJson,
          })
          .onConflict((oc) =>
            oc.columns(["project_id", "scope_key"]).doUpdateSet((eb) => ({
              manifest_filters_json: eb.ref("excluded.manifest_filters_json"),
              updated_at: sql<string>`strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
            })),
          )
          .execute(),
      );
    }),
});
