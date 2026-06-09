import { compact } from "@better-update/type-guards";
import { Context, Effect, Layer } from "effect";

import { d1Batch, kyselyDb } from "../cloudflare/db";
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

const COLUMNS = [
  "id",
  "organization_id",
  "name",
  "description",
  "document",
  "created_at",
  "updated_at",
] as const;

export const PolicyRepoLive = Layer.succeed(PolicyRepo, {
  list: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("policy")
          .select(COLUMNS)
          .where("organization_id", "=", params.organizationId)
          .orderBy("name", "asc")
          .execute(),
      );
      return rows.map(toModel);
    }),

  findById: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const row = yield* Effect.promise(async () =>
        db
          .selectFrom("policy")
          .select(COLUMNS)
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),

  findDocumentsByIds: (params) =>
    Effect.gen(function* () {
      if (params.ids.length === 0) {
        return new Map<string, PolicyDocument>();
      }
      const db = yield* kyselyDb;
      const rows = yield* Effect.promise(async () =>
        db
          .selectFrom("policy")
          .select(["id", "document"])
          .where("organization_id", "=", params.organizationId)
          .where("id", "in", params.ids)
          .execute(),
      );
      return new Map(rows.map((row) => [row.id, parseDocument(row.document)]));
    }),

  create: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = yield* d1WithUniqueCheck(
        async () =>
          db
            .insertInto("policy")
            .values({
              id,
              organization_id: params.organizationId,
              name: params.name,
              description: params.description,
              document: JSON.stringify(params.document),
              created_at: now,
              updated_at: null,
            })
            .returning(COLUMNS)
            .executeTakeFirst(),
        "A policy with this name already exists",
      );
      return row === undefined
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
      const db = yield* kyselyDb;
      const now = new Date().toISOString();
      const patch = compact({
        name: params.name,
        description: params.description,
        document: params.document === undefined ? undefined : JSON.stringify(params.document),
        updated_at: now,
      });
      const row = yield* Effect.promise(async () =>
        db
          .updateTable("policy")
          .set(patch)
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .returning(COLUMNS)
          .executeTakeFirst(),
      );
      return row === undefined ? null : toModel(row);
    }),

  delete: (params) =>
    Effect.gen(function* () {
      const db = yield* kyselyDb;
      // Atomic cascade (D1 has no interactive transactions): clear attachments
      // then delete the policy in one batch. The policy delete returns its id so
      // a non-empty result row means the row existed in this org.
      const [, deletedPolicy] = yield* d1Batch([
        db
          .deleteFrom("policy_attachment")
          .where("policy_id", "=", params.id)
          .where("organization_id", "=", params.organizationId),
        db
          .deleteFrom("policy")
          .where("id", "=", params.id)
          .where("organization_id", "=", params.organizationId)
          .returning("id"),
      ]);
      return deletedPolicy.length > 0;
    }),
});
