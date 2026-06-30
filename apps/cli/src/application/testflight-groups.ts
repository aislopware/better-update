/**
 * TestFlight beta-group operations on the headless ASC (`@expo/apple-utils`)
 * entity layer. Backs the `testflight group` command group — the unblocker for
 * `submit ios`, which hard-fails (`TESTFLIGHT_GROUP_NOT_FOUND`) when a profile
 * names a group that does not exist yet. Each function takes a resolved
 * {@link AscSession} context + app id and returns plain data for the JSON
 * envelope; the command shell renders the human view.
 */
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";
import { AppStoreError } from "../lib/exit-codes";

/** A beta group projected to the fields the CLI surfaces. */
export interface BetaGroupView {
  readonly id: string;
  readonly name: string;
  readonly internal: boolean;
  readonly publicLink: string | null;
}

const toView = (group: AppleUtils.BetaGroup): BetaGroupView => ({
  id: group.id,
  name: group.attributes.name,
  internal: group.attributes.isInternalGroup,
  publicLink: group.attributes.publicLink,
});

/** List every beta group for an app, newest-managed view first (Apple's order). */
export const listBetaGroups = (ctx: AppleUtils.RequestContext, appId: string) =>
  wrapConnect("apple-list-beta-groups", async () =>
    AppleUtils.BetaGroup.getAsync(ctx, { query: { filter: { app: appId } } }),
  ).pipe(Effect.map((groups) => groups.map(toView)));

export interface CreateBetaGroupInput {
  readonly name: string;
  /** Internal groups admit only App Store Connect users; external groups need review. */
  readonly internal: boolean;
  readonly publicLinkEnabled: boolean;
  readonly publicLinkLimit: number | undefined;
}

/**
 * Create a beta group on the app. Guards against a duplicate name up front so a
 * re-run reports the existing group instead of letting Apple reject it with an
 * opaque 409.
 */
export const createBetaGroup = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  input: CreateBetaGroupInput,
) =>
  Effect.gen(function* () {
    const existing = yield* listBetaGroups(ctx, appId);
    if (existing.some((group) => group.name === input.name)) {
      return yield* new AppStoreError({
        message: `A TestFlight group named "${input.name}" already exists for this app.`,
      });
    }
    const created = yield* wrapConnect("apple-create-beta-group", async () =>
      AppleUtils.BetaGroup.createAsync(ctx, {
        id: appId,
        name: input.name,
        isInternalGroup: input.internal,
        publicLinkEnabled: input.publicLinkEnabled,
        ...(input.publicLinkLimit === undefined
          ? {}
          : { publicLinkLimit: input.publicLinkLimit, publicLinkLimitEnabled: true }),
      }),
    );
    return toView(created);
  });

/** Resolve a beta group by id or name, failing with a clear list when not found. */
export const findBetaGroup = (
  ctx: AppleUtils.RequestContext,
  appId: string,
  selector: { readonly id: string | undefined; readonly name: string | undefined },
) =>
  Effect.gen(function* () {
    const groups = yield* listBetaGroups(ctx, appId);
    const match = groups.find((group) =>
      selector.id === undefined ? group.name === selector.name : group.id === selector.id,
    );
    if (match === undefined) {
      const available = groups.map((group) => group.name).join(", ") || "(none)";
      const wanted = selector.id ?? selector.name ?? "(unspecified)";
      return yield* new AppStoreError({
        message: `TestFlight group "${wanted}" not found. Available groups: ${available}.`,
      });
    }
    return match;
  });

/** Delete a beta group by id. */
export const deleteBetaGroup = (ctx: AppleUtils.RequestContext, id: string) =>
  wrapConnect("apple-delete-beta-group", async () => AppleUtils.BetaGroup.deleteAsync(ctx, { id }));
