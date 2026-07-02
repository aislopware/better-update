import { it } from "@effect/vitest";
import { Effect } from "effect";

import { PolicyAttachmentRepo } from "../repositories/policy-attachment-repo";
import { PolicyRepo } from "../repositories/policy-repo";
import { resolveManagedDocument } from "./managed-policies";
import { statementsForPrincipals } from "./statements";

import type { PolicyAttachmentModel, PolicyDocument } from "../models";
import type { PolicyAttachmentRepository } from "../repositories/policy-attachment-repo";
import type { PolicyRepository } from "../repositories/policy-repo";

// Unit-level pin of the shared statement-resolution algorithm (managed ids from
// code, real ids from one batched read, policy-id dedup) against stubbed repos.
// The same function runs against real D1 in
// tests/integration/auth/statement-resolution.test.ts.

const ORG = "org-1";

const attachment = (policyId: string, index: number): PolicyAttachmentModel => ({
  id: `att-${String(index)}`,
  organizationId: ORG,
  policyId,
  principalType: "robot",
  principalId: "robot-1",
  createdAt: "2026-01-01T00:00:00Z",
});

const unused = (method: string) => () => Effect.die(`unexpected call: ${method}`);

const attachmentRepoStub = (
  attachments: readonly PolicyAttachmentModel[],
): PolicyAttachmentRepository => ({
  findForPrincipals: () => Effect.succeed(attachments),
  listForPrincipal: unused("listForPrincipal"),
  listByOrg: unused("listByOrg"),
  attach: unused("attach"),
  detach: unused("detach"),
});

const policyRepoStub = (documents: ReadonlyMap<string, PolicyDocument>): PolicyRepository => ({
  list: unused("list"),
  findById: unused("findById"),
  findDocumentsByIds: () => Effect.succeed(documents),
  create: unused("create"),
  update: unused("update"),
  delete: unused("delete"),
});

const resolve = (
  attachments: readonly PolicyAttachmentModel[],
  documents: ReadonlyMap<string, PolicyDocument>,
) =>
  statementsForPrincipals({
    organizationId: ORG,
    principals: [{ type: "robot", id: "robot-1" }],
  }).pipe(
    Effect.provideService(PolicyAttachmentRepo, attachmentRepoStub(attachments)),
    Effect.provideService(PolicyRepo, policyRepoStub(documents)),
  );

describe("statement resolution for principals", () => {
  it.effect("no principals resolves to [] without consulting any repo", () =>
    Effect.gen(function* () {
      const statements = yield* statementsForPrincipals({
        organizationId: ORG,
        principals: [],
      }).pipe(
        Effect.provideService(PolicyAttachmentRepo, {
          ...attachmentRepoStub([]),
          findForPrincipals: unused("findForPrincipals"),
        }),
        Effect.provideService(PolicyRepo, policyRepoStub(new Map())),
      );
      expect(statements).toStrictEqual([]);
    }),
  );

  it.effect("the managed admin id resolves from code (no real-doc lookup needed)", () =>
    Effect.gen(function* () {
      const statements = yield* resolve([attachment("managed:admin", 1)], new Map());
      expect(statements).toStrictEqual(resolveManagedDocument("managed:admin")?.statements);
    }),
  );

  it.effect("removed managed ids (roles/capabilities) contribute nothing", () =>
    Effect.gen(function* () {
      const statements = yield* resolve(
        [
          attachment("managed:developer", 1),
          attachment("managed:viewer@proj-1", 2),
          attachment("managed:cap-credentials", 3),
        ],
        new Map(),
      );
      expect(statements).toStrictEqual([]);
    }),
  );

  it.effect("real policy ids resolve through the repo, deduped per policy id", () =>
    Effect.gen(function* () {
      const doc: PolicyDocument = {
        statements: [{ effect: "allow", actions: ["channel:create"], resources: ["project/A"] }],
      };
      const statements = yield* resolve(
        // The same policy attached twice (e.g. two principals in a real request)
        // must contribute its statements ONCE.
        [attachment("pol-1", 1), attachment("pol-1", 2)],
        new Map([["pol-1", doc]]),
      );
      expect(statements).toStrictEqual(doc.statements);
    }),
  );

  it.effect("an attachment whose policy no longer exists contributes nothing", () =>
    Effect.gen(function* () {
      const statements = yield* resolve([attachment("pol-gone", 1)], new Map());
      expect(statements).toStrictEqual([]);
    }),
  );
});
