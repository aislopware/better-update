/**
 * TestFlight beta-tester operations on the headless ASC (`@expo/apple-utils`)
 * entity layer. Backs the `testflight tester` command group. In v2.1.21 a
 * `BetaGroup` has no tester getters/removers — testers are listed via
 * `BetaTester.getAsync` with a group/app filter, single-added via
 * `BetaTester.createAsync`, bulk-imported through the group entity, and removed
 * via the tester instance. Each function returns plain data for the JSON envelope.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";

/** A beta tester projected to the fields the CLI surfaces. */
export interface BetaTesterView {
  readonly id: string;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly state: string | null;
  readonly inviteType: string | null;
}

const toView = (tester: AppleUtils.BetaTester): BetaTesterView => ({
  id: tester.id,
  email: toDbNull(tester.attributes.email),
  firstName: tester.attributes.firstName,
  lastName: tester.attributes.lastName,
  state: toDbNull(tester.attributes.betaTesterState ?? tester.attributes.state),
  inviteType: toDbNull(tester.attributes.inviteType),
});

/**
 * List testers, scoped to a beta group when `groupId` is given, otherwise to the
 * whole app. (`BetaGroup` exposes no tester getter — filter `BetaTester.getAsync`.)
 */
export const listTesters = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  groupId: string | undefined,
) => {
  const filter = groupId === undefined ? { apps: [appId] } : { betaGroups: [groupId] };
  return wrapConnect("apple-list-beta-testers", async () =>
    AppleUtils.BetaTester.getAsync(ctx, { query: { filter } }),
  ).pipe(Effect.map((testers) => testers.map(toView)));
};

export interface AddTesterInput {
  readonly email: string;
  readonly firstName: string | undefined;
  readonly lastName: string | undefined;
  /** Send the TestFlight email invitation immediately after creating the tester. */
  readonly invite: boolean;
}

/** Add a single tester to a beta group, optionally emailing the invite. */
export const addTester = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  betaGroupId: string,
  input: AddTesterInput,
) =>
  Effect.gen(function* () {
    const tester = yield* wrapConnect("apple-create-beta-tester", async () =>
      AppleUtils.BetaTester.createAsync(ctx, {
        betaGroupId,
        email: input.email,
        ...compact({ firstName: input.firstName, lastName: input.lastName }),
      }),
    );
    if (input.invite) {
      yield* wrapConnect("apple-invite-beta-tester", async () =>
        AppleUtils.BetaTesterInvitation.createAsync(ctx, { id: appId, betaTesterId: tester.id }),
      );
    }
    return toView(tester);
  });

export interface ImportTesterRow {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

/** One row of {@link importTesters}'s result: Apple's per-tester assignment outcome. */
export interface ImportResultRow {
  readonly email: string | null;
  readonly result: string;
  readonly errors: readonly string[];
}

/**
 * Bulk-import testers into a beta group. Apple returns a per-tester
 * `assignmentResult` (ASSIGNED / FAILED / NOT_QUALIFIED_FOR_INTERNAL_GROUP), so a
 * partial success is surfaced row-by-row rather than failing the whole batch.
 */
export const importTesters = (group: AppleUtils.BetaGroup, rows: readonly ImportTesterRow[]) =>
  wrapConnect("apple-bulk-beta-testers", async () =>
    group.createBulkBetaTesterAssignmentsAsync([...rows]),
  ).pipe(
    Effect.map((assignment) =>
      assignment.attributes.betaTesters.map(
        (tester): ImportResultRow => ({
          email: tester.email,
          result: tester.assignmentResult,
          errors: (tester.errors ?? []).map((error) => error.key),
        }),
      ),
    ),
  );

export interface RemoveTesterInput {
  readonly email: string;
  /** When deleting from a group only, the resolved group id; ignored if `deleteAccount`. */
  readonly groupId: string | undefined;
  /** Delete the tester account entirely (from every group + the app). */
  readonly deleteAccount: boolean;
}

/** Remove a tester from a single group, or delete the tester account entirely. */
export const removeTester = (ctx: AppleUtils.RequestContext, input: RemoveTesterInput) =>
  Effect.gen(function* () {
    const tester = yield* wrapConnect("apple-find-beta-tester", async () =>
      AppleUtils.BetaTester.findAsync(ctx, { email: input.email }),
    );
    if (tester === null) {
      return yield* new AppStoreError({
        message: `No TestFlight tester found with email ${input.email}.`,
      });
    }
    if (input.deleteAccount) {
      yield* wrapConnect("apple-delete-beta-tester", async () => tester.deleteAsync());
      return { id: tester.id, email: input.email, removed: "account" };
    }
    const { groupId } = input;
    if (groupId === undefined) {
      return yield* new AppStoreError({
        message:
          "Specify --group/--group-id to remove the tester from a group, or --delete to remove the tester entirely.",
      });
    }
    yield* wrapConnect("apple-remove-beta-tester-from-group", async () =>
      tester.deleteBetaGroupsAsync({ betaGroups: [groupId] }),
    );
    return { id: tester.id, email: input.email, removed: "group" };
  });
