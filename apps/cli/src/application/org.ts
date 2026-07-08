import { Effect } from "effect";

import { InvalidArgumentError } from "../lib/exit-codes";

import type { AuthRequiredError, OrgError } from "../lib/exit-codes";
import type { AuthOrganization } from "../services/api-client";

/** The slice of `ApiClientService` the org use cases need — injected for testability. */
export interface OrgGateway {
  readonly listOrganizations: Effect.Effect<
    readonly AuthOrganization[],
    AuthRequiredError | OrgError
  >;
  readonly setActiveOrganization: (
    organizationId: string,
  ) => Effect.Effect<void, AuthRequiredError | OrgError>;
}

/** Match an organization by slug (the human-facing handle) first, then by raw id. */
export const resolveOrganization = (
  organizations: readonly AuthOrganization[],
  selector: string,
): AuthOrganization | undefined =>
  organizations.find((org) => org.slug === selector) ??
  organizations.find((org) => org.id === selector);

/**
 * Point the CLI session at another organization: resolve the selector against
 * the user's memberships and set it active server-side. Every later command —
 * projects, robots, env vars, vaults — scopes to the newly active organization.
 */
export const switchOrganization = (gateway: OrgGateway, selector: string) =>
  Effect.gen(function* () {
    const organizations = yield* gateway.listOrganizations;
    const target = resolveOrganization(organizations, selector);
    if (target === undefined) {
      return yield* new InvalidArgumentError({
        message: `No organization matches "${selector}" — pass a slug or id from \`better-update org list\`.`,
      });
    }
    yield* gateway.setActiveOrganization(target.id);
    return target;
  });
