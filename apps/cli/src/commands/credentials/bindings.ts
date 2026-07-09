import { defineCommand } from "citty";
import { Effect } from "effect";

import type { CredentialBindingTypeValue } from "@better-update/api";

import { runEffect } from "../../lib/citty-effect";
import { IdentityError, InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman, printHumanList } from "../../lib/output";
import { readProjectId } from "../../lib/project-link";
import { apiClient } from "../../services/api-client";

// Mirrors the API's CredentialBindingType (GITLAB-RBAC-SPEC §1a). `appleTeam`
// cascades to every child credential + the team's devices; `ascApiKey` is for
// team-less keys only; the android kinds bind per-row.
const BINDING_TYPES = [
  "appleTeam",
  "ascApiKey",
  "googleServiceAccountKey",
  "androidUploadKeystore",
] as const satisfies readonly CredentialBindingTypeValue[];

const parseBindingType = (
  raw: string,
): Effect.Effect<CredentialBindingTypeValue, InvalidArgumentError> => {
  const match = BINDING_TYPES.find((candidate) => candidate === raw);
  return match === undefined
    ? new InvalidArgumentError({
        message: `Invalid resource type "${raw}" — expected one of ${BINDING_TYPES.join("|")}.`,
      })
    : Effect.succeed(match);
};

/** `--project` flag when given, else the linked project from the local context. */
const resolveProjectId = (flag: string | undefined) => {
  const value = flag?.trim();
  if (value !== undefined && value.length > 0) {
    return Effect.succeed(value);
  }
  return readProjectId.pipe(
    Effect.mapError(
      () =>
        new IdentityError({
          message:
            "Bindings are per project — pass --project <projectId> or run this inside a linked project.",
        }),
    ),
  );
};

const projectArg = {
  project: {
    type: "string",
    description: "Project id (defaults to the linked project from the local context)",
  },
} as const;

const resourceArgs = {
  resourceType: {
    type: "positional",
    required: true,
    description: `Credential kind: ${BINDING_TYPES.join(" | ")}`,
  },
  resourceId: {
    type: "positional",
    required: true,
    description: "Credential id (internal UUID, e.g. from `credentials list` / the dashboard)",
  },
  ...projectArg,
  "all-projects": {
    type: "boolean",
    default: false,
    description:
      "Bind org-wide: every project of the org, including projects created later (ignores --project)",
  },
} as const;

const listCommand = defineCommand({
  meta: {
    name: "list",
    description: "List the org credentials bound to a project (org admin only)",
  },
  args: { ...projectArg },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const projectId = yield* resolveProjectId(args.project);
        const { items } = yield* api["credential-bindings"].list({ path: { id: projectId } });
        yield* printHumanList(
          ["Resource type", "Resource id", "Scope", "Bound at"],
          items.map((binding) => [
            binding.resourceType,
            binding.resourceId,
            binding.allProjects ? "all projects" : "this project",
            binding.createdAt,
          ]),
          "No credentials bound to this project — bind one with `better-update credentials bindings add <resourceType> <resourceId>`.",
        );
        return { projectId, items };
      }),
      { json: "value" },
    ),
});

const addCommand = defineCommand({
  meta: {
    name: "add",
    description:
      "Bind an org credential to a project so its members can use it (org admin only; idempotent)",
  },
  args: resourceArgs,
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const resourceType = yield* parseBindingType(args.resourceType);
        const teamHint =
          resourceType === "appleTeam"
            ? " The binding covers every credential and device under this team."
            : "";
        if (args["all-projects"]) {
          const binding = yield* api["credential-bindings"].bindAllProjects({
            path: { resourceType, resourceId: args.resourceId },
          });
          yield* printHuman(
            `✓ Bound ${resourceType} ${args.resourceId} to ALL projects — including projects created later.${teamHint}`,
          );
          return { binding };
        }
        const projectId = yield* resolveProjectId(args.project);
        const binding = yield* api["credential-bindings"].bind({
          path: { id: projectId, resourceType, resourceId: args.resourceId },
        });
        yield* printHuman(
          `✓ Bound ${resourceType} ${args.resourceId} to project ${projectId}.${teamHint}`,
        );
        return { binding };
      }),
      { json: "value" },
    ),
});

const planCommand = defineCommand({
  meta: {
    name: "plan",
    description:
      "Show the bindings existing project configs rely on and which are missing; --apply binds the missing ones (org admin only)",
  },
  args: {
    apply: {
      type: "boolean",
      default: false,
      description: "Bind every missing item (idempotent — safe to re-run)",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const { items } = yield* api["credential-bindings"].plan();
        yield* printHumanList(
          ["Project", "Resource type", "Resource", "Status"],
          items.map((item) => [
            item.projectName,
            item.resourceType,
            item.resourceLabel,
            item.alreadyBound ? "✓ bound" : "✗ missing",
          ]),
          "No project configs reference org credentials yet.",
        );
        const missing = items.filter((item) => !item.alreadyBound);
        if (items.length > 0) {
          yield* printHuman(`${missing.length} missing of ${items.length}.`);
        }
        if (!args.apply) {
          return { items, applied: 0 };
        }
        // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, callback) is not Array.prototype.forEach
        yield* Effect.forEach(missing, (item) =>
          api["credential-bindings"]
            .bind({
              path: {
                id: item.projectId,
                resourceType: item.resourceType,
                resourceId: item.resourceId,
              },
            })
            .pipe(
              Effect.zipRight(printHuman(`✓ Bound ${item.resourceLabel} → ${item.projectName}`)),
            ),
        );
        yield* printHuman(
          missing.length === 0
            ? "Nothing to apply — every binding is already in place."
            : `Applied ${missing.length} binding${missing.length === 1 ? "" : "s"}.`,
        );
        return { items, applied: missing.length };
      }),
      { json: "value" },
    ),
});

const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description:
      "Unbind an org credential from a project — its members (and robot) lose access to it (org admin only)",
  },
  args: resourceArgs,
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const resourceType = yield* parseBindingType(args.resourceType);
        if (args["all-projects"]) {
          yield* api["credential-bindings"].unbindAllProjects({
            path: { resourceType, resourceId: args.resourceId },
          });
          yield* printHuman(
            `✓ Removed the all-projects binding of ${resourceType} ${args.resourceId} — explicit per-project bindings still apply.`,
          );
          return { removed: true, allProjects: true, resourceType, resourceId: args.resourceId };
        }
        const projectId = yield* resolveProjectId(args.project);
        yield* api["credential-bindings"].unbind({
          path: { id: projectId, resourceType, resourceId: args.resourceId },
        });
        yield* printHuman(
          `✓ Unbound ${resourceType} ${args.resourceId} from project ${projectId}.`,
        );
        return { removed: true, projectId, resourceType, resourceId: args.resourceId };
      }),
      { json: "value" },
    ),
});

export const bindingsCommand = defineCommand({
  meta: {
    name: "bindings",
    description:
      "Manage credential→project bindings: org credentials are usable in a project only when bound (GitLab-style RBAC)",
  },
  subCommands: {
    list: listCommand,
    plan: planCommand,
    add: addCommand,
    remove: removeCommand,
  },
  default: "list",
});
