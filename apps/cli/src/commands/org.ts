import { compact } from "@better-update/type-guards";
import { defineCommand } from "citty";
import { Effect } from "effect";

import { forgetCachedEnvVaultKey } from "../application/env-vault-access";
import { switchOrganization } from "../application/org";
import { forgetCachedVaultKey } from "../application/vault-access";
import { runEffect } from "../lib/citty-effect";
import { printHuman, printHumanList } from "../lib/output";
import { promptSelect } from "../lib/prompts";
import { apiClient, ApiClientService } from "../services/api-client";

// The id of the org this session currently operates on (`/api/me`), used to
// mark the active row in `list` and to hint the prompt in `switch`.
const activeOrganizationId = Effect.gen(function* () {
  const api = yield* apiClient;
  const me = yield* api.me.get();
  return me.activeOrganization?.id;
});

// Lock the org being left: drop both of its cached vault keys so walking away
// from an org also walks away from its unlocked secrets, rather than leaving
// them readable for the rest of the TTL.
//
// This is no longer what keeps the vaults APART — the cache is keyed by org, so
// the new org simply cannot see this entry either way. It takes the id of the
// org being LEFT because it runs after the switch has already landed, when
// "active org" means the new one.
//
// Best-effort: a device without a local identity has nothing cached.
const dropVaultCaches = (orgId: string) =>
  Effect.all([forgetCachedVaultKey(orgId), forgetCachedEnvVaultKey(orgId)]).pipe(
    Effect.catchAll(() => Effect.void),
  );

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the organizations you belong to (● marks this session's active one)",
  },
  run: async () =>
    runEffect(
      Effect.gen(function* () {
        const service = yield* ApiClientService;
        const organizations = yield* service.listOrganizations;
        const activeId = yield* activeOrganizationId;
        yield* printHumanList(
          ["Active", "Name", "Slug", "Id"],
          organizations.map((org) => [org.id === activeId ? "●" : "", org.name, org.slug, org.id]),
          "You don't belong to any organization yet — create one in the web dashboard.",
        );
        return { items: organizations, activeOrganizationId: activeId };
      }),
      { json: "value" },
    ),
});

const promptForOrganization = Effect.gen(function* () {
  const service = yield* ApiClientService;
  const organizations = yield* service.listOrganizations;
  const activeId = yield* activeOrganizationId;
  return yield* promptSelect(
    "Switch the active organization to:",
    organizations.map((org) =>
      compact({
        value: org.id,
        label: `${org.name} (${org.slug})`,
        hint: org.id === activeId ? "active" : undefined,
      }),
    ),
  );
});

const switchCommand = defineCommand({
  meta: {
    name: "switch",
    description:
      "Set this CLI session's active organization — projects, robots, env vars, and vaults all scope to it",
  },
  args: {
    org: {
      type: "positional",
      required: false,
      description: "Organization slug or id (prompts interactively when omitted)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const service = yield* ApiClientService;
        const flag = args.org?.trim();
        const selector =
          flag !== undefined && flag.length > 0 ? flag : yield* promptForOrganization;
        const leavingOrgId = yield* activeOrganizationId;
        const target = yield* switchOrganization(service, selector);
        if (leavingOrgId !== undefined) {
          yield* dropVaultCaches(leavingOrgId);
        }
        const api = yield* apiClient;
        const me = yield* api.me.get();
        const role = me.activeOrganization?.role;
        yield* printHuman(
          `✓ Switched to ${target.name} (${target.slug})${role ? ` — your role: ${role}` : ""}.`,
        );
        return { id: target.id, name: target.name, slug: target.slug, role };
      }),
      { json: "value" },
    ),
});

export const orgCommand = defineCommand({
  meta: {
    name: "org",
    description:
      "Show and switch this session's active organization (set at login, otherwise sticky)",
  },
  subCommands: {
    list: listCommand,
    switch: switchCommand,
  },
  default: "list",
});
