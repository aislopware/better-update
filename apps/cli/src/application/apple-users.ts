/**
 * App Store Connect **team / seat administration** on the headless ASC
 * (`@expo/apple-utils`) entity layer. Backs the `apple users` command group: list
 * users and invite new ones. Token/CI-safe, but the ASC API key must carry the
 * `ADMIN` role or Apple returns 403 (surfaced as a plain connect error).
 *
 * Users are never created directly — `apple users invite` emails a
 * `UserInvitation`; the person joins by accepting it.
 */
import { compact, toDbNull } from "@better-update/type-guards";
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { wrapConnect } from "../lib/apple-asc-connect";

/** A team user projected to the fields the CLI surfaces. */
export interface UserView {
  readonly id: string;
  readonly username: string | null;
  readonly email: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly roles: readonly string[];
  readonly allAppsVisible: boolean;
}

const toView = (user: AppleUtils.User): UserView => ({
  id: user.id,
  username: toDbNull(user.attributes.username),
  email: toDbNull(user.attributes.email),
  firstName: user.attributes.firstName,
  lastName: user.attributes.lastName,
  roles: user.attributes.roles ?? [],
  allAppsVisible: user.attributes.allAppsVisible,
});

/** List the team's users and their roles. Requires an ADMIN-role ASC API key. */
export const listUsers = (ctx: AppleUtils.RequestContext) =>
  wrapConnect("apple-list-users", async () => AppleUtils.User.getAsync(ctx)).pipe(
    Effect.map((users) => users.map(toView)),
  );

export interface InviteUserInput {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly roles: readonly AppleUtils.UserRole[];
  readonly provisioningAllowed: boolean | undefined;
  /** App ids to scope the user to; an EMPTY list means all apps are visible. */
  readonly visibleApps: readonly string[];
}

/**
 * Decide the app-visibility relationship for an invite: a non-empty list scopes
 * the user to those apps; an empty list leaves all apps visible (so an empty
 * `--visible-apps` never invites a user scoped to zero apps).
 */
export const resolveVisibleAppsScope = (
  visibleApps: readonly string[],
): { readonly allAppsVisible: boolean; readonly visibleApps: readonly string[] | undefined } =>
  visibleApps.length > 0
    ? { allAppsVisible: false, visibleApps }
    : { allAppsVisible: true, visibleApps: undefined };

/**
 * Invite a user to the team (Apple emails the invitation). App visibility follows
 * {@link resolveVisibleAppsScope}. Requires an ADMIN-role ASC API key.
 */
export const inviteUser = (ctx: AppleUtils.RequestContext, input: InviteUserInput) => {
  const scope = resolveVisibleAppsScope(input.visibleApps);
  return wrapConnect("apple-invite-user", async () =>
    AppleUtils.UserInvitation.createAsync(ctx, {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      roles: [...input.roles],
      allAppsVisible: scope.allAppsVisible,
      ...compact({
        provisioningAllowed: input.provisioningAllowed,
        visibleApps: scope.visibleApps === undefined ? undefined : [...scope.visibleApps],
      }),
    }),
  ).pipe(
    Effect.map((invitation) => ({
      id: invitation.id,
      email: invitation.attributes.email,
      roles: invitation.attributes.roles ?? [],
      expirationDate: invitation.attributes.expirationDate,
    })),
  );
};
