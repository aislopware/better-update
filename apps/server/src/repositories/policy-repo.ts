import { toDbNull } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { cloudflareEnv } from "../cloudflare/context";
import { d1WithUniqueCheck } from "./d1-helpers";

import type { Conflict } from "../errors";
import type { PolicyDocument, PolicyModel } from "../models";

// -- Port -------------------------------------------------------------------

export interface CreatePolicyInput {
  readonly organizationId: string;
  readonly name: string;
  readonly description: string | null;
  readonly document: PolicyDocument;
}

export interface UpdatePolicyInput {
  readonly id: string;
  readonly organizationId: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly document?: PolicyDocument;
}

export interface PolicyRepository {
  /** All custom policies in an org (managed presets are merged in by the handler). */
  readonly list: (params: {
    readonly organizationId: string;
  }) => Effect.Effect<readonly PolicyModel[]>;

  /** One policy by id, tenant-scoped. `null` if absent or in another org. */
  readonly findById: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<PolicyModel | null>;

  /**
   * Documents for a set of real policy ids, tenant-scoped, keyed by id. Used by
   * middleware statement resolution (managed ids are resolved from code first).
   */
  readonly findDocumentsByIds: (params: {
    readonly organizationId: string;
    readonly ids: readonly string[];
  }) => Effect.Effect<ReadonlyMap<string, PolicyDocument>>;

  /** Create a policy. Fails {@link Conflict} when the org already has this name. */
  readonly create: (params: CreatePolicyInput) => Effect.Effect<PolicyModel, Conflict>;

  /** Update name/description/document; `null` if the row is absent in this org. */
  readonly update: (params: UpdatePolicyInput) => Effect.Effect<PolicyModel | null>;

  /** Delete a policy + sweep its attachments. Returns false if absent in this org. */
  readonly delete: (params: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean>;
}

export class PolicyRepo extends Context.Tag("api/PolicyRepo")<PolicyRepo, PolicyRepository>() {}

// -- D1 Adapter -------------------------------------------------------------

interface PolicyRow {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  document: string;
  created_at: string;
  updated_at: string | null;
}

const parseDocument = (raw: string): PolicyDocument =>
  // The column is a JSON policy document we wrote + validated at the handler.
  // eslint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- JSON column round-trips our own PolicyDocument payload
  JSON.parse(raw) as PolicyDocument;

const toModel = (row: PolicyRow): PolicyModel => ({
  id: row.id,
  organizationId: row.organization_id,
  name: row.name,
  description: row.description,
  document: parseDocument(row.document),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = `"id", "organization_id", "name", "description", "document", "created_at", "updated_at"`;

export const PolicyRepoLive = Layer.succeed(PolicyRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT ${COLUMNS} FROM "policy" WHERE "organization_id" = ? ORDER BY "name" ASC`,
        )
          .bind(params.organizationId)
          .all<PolicyRow>(),
      );
      return rows.results.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(`SELECT ${COLUMNS} FROM "policy" WHERE "id" = ? AND "organization_id" = ?`)
          .bind(params.id, params.organizationId)
          .first<PolicyRow>(),
      );
      return row === null ? null : toModel(row);
    }),

  findDocumentsByIds: (params) =>
    Effect.gen(function* () {
      if (params.ids.length === 0) {
        return new Map<string, PolicyDocument>();
      }
      const env = yield* cloudflareEnv;
      const placeholders = params.ids.map(() => "?").join(", ");
      const rows = yield* Effect.promise(async () =>
        env.DB.prepare(
          `SELECT "id", "document" FROM "policy" WHERE "organization_id" = ? AND "id" IN (${placeholders})`,
        )
          .bind(params.organizationId, ...params.ids)
          .all<{ id: string; document: string }>(),
      );
      return new Map(rows.results.map((row) => [row.id, parseDocument(row.document)]));
    }),

  create: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = yield* d1WithUniqueCheck(
        async () =>
          env.DB.prepare(
            `INSERT INTO "policy" (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
          )
            .bind(
              id,
              params.organizationId,
              params.name,
              params.description,
              JSON.stringify(params.document),
              now,
              null,
            )
            .first<PolicyRow>(),
        "A policy with this name already exists",
      );
      return row === null
        ? {
            id,
            organizationId: params.organizationId,
            name: params.name,
            description: params.description,
            document: params.document,
            createdAt: now,
            updatedAt: null,
          }
        : toModel(row);
    }),

  update: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const now = new Date().toISOString();
      const row = yield* Effect.promise(async () =>
        env.DB.prepare(
          `UPDATE "policy" SET
             "name" = COALESCE(?, "name"),
             "description" = CASE WHEN ? = 1 THEN ? ELSE "description" END,
             "document" = COALESCE(?, "document"),
             "updated_at" = ?
           WHERE "id" = ? AND "organization_id" = ?
           RETURNING ${COLUMNS}`,
        )
          .bind(
            toDbNull(params.name),
            params.description === undefined ? 0 : 1,
            toDbNull(params.description),
            params.document === undefined ? null : JSON.stringify(params.document),
            now,
            params.id,
            params.organizationId,
          )
          .first<PolicyRow>(),
      );
      return row === null ? null : toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const env = yield* cloudflareEnv;
      const result = yield* Effect.promise(async () =>
        env.DB.batch([
          env.DB.prepare(
            `DELETE FROM "policy_attachment" WHERE "policy_id" = ? AND "organization_id" = ?`,
          ).bind(params.id, params.organizationId),
          env.DB.prepare(`DELETE FROM "policy" WHERE "id" = ? AND "organization_id" = ?`).bind(
            params.id,
            params.organizationId,
          ),
        ]),
      );
      // The second statement is the policy delete; meta.changes > 0 → existed.
      return (result[1]?.meta.changes ?? 0) > 0;
    }),
});
