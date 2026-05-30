import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../../lib/citty-effect";
import {
  deleteCredential,
  filterCredentials,
  listAllCredentials,
} from "../../lib/credentials-manager";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { promptConfirm, promptSelect } from "../../lib/prompts";
import { apiClient } from "../../services/api-client";

import type {
  CliCredentialPlatform,
  CliCredentialRow,
  CliCredentialType,
} from "../../lib/credentials-manager";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "provisioning-profile",
  "push-key",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

const isPlatform = (value: string): value is CliCredentialPlatform =>
  value === "ios" || value === "android";

const isType = (value: string): value is CliCredentialType =>
  (CREDENTIAL_TYPES as readonly string[]).includes(value);

const formatRowLabel = (row: CliCredentialRow): string => {
  const distro = row.distribution ? ` (${row.distribution})` : "";
  return `${row.type}: ${row.name}${distro} — ${row.id.slice(0, 8)}…`;
};

export const removeCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Interactively pick a credential to delete (uses prompts to narrow the choice)",
  },
  args: {
    platform: {
      type: "enum",
      options: ["ios", "android"],
      description: "Pre-filter by platform",
    },
    type: {
      type: "enum",
      options: [...CREDENTIAL_TYPES],
      description: "Pre-filter by credential type",
    },
    yes: {
      type: "boolean",
      description: "Skip the final confirmation prompt",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const api = yield* apiClient;
        const rows = yield* listAllCredentials(api);

        const platform = yield* resolvePlatform(args.platform);
        const platformRows = filterCredentials(rows, { platform });
        if (platformRows.length === 0) {
          yield* printHuman(`No ${platform} credentials to remove.`);
          return { deleted: false, reason: "none-for-platform" as const };
        }

        const availableTypes = [...new Set(platformRows.map((row) => row.type))];
        const type = yield* resolveType(args.type, availableTypes);
        const filtered = filterCredentials(platformRows, { type });
        if (filtered.length === 0) {
          yield* printHuman(`No ${platform} ${type} credentials to remove.`);
          return { deleted: false, reason: "none-for-type" as const };
        }

        const id = yield* promptSelect<string>(
          `Select a ${type} to remove`,
          filtered.map((row) => ({ value: row.id, label: formatRowLabel(row) })),
        );

        if (!args.yes) {
          const confirmed = yield* promptConfirm(
            `Delete ${type} ${id.slice(0, 8)}…? This cannot be undone.`,
            { initialValue: false },
          );
          if (!confirmed) {
            yield* printHuman("Aborted.");
            return { deleted: false, reason: "cancelled" as const };
          }
        }

        yield* deleteCredential(api, { id, platform, type });
        yield* printHuman(`Credential ${id} deleted.`);
        return { deleted: true, id, platform, type };
      }),
      { json: "value" },
    ),
});

const resolvePlatform = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* promptSelect<CliCredentialPlatform>("Filter by platform", [
        { value: "ios", label: "iOS" },
        { value: "android", label: "Android" },
      ]);
    }
    if (!isPlatform(raw)) {
      return yield* new InvalidArgumentError({ message: `Invalid platform "${raw}"` });
    }
    return raw;
  });

const resolveType = (raw: string | undefined, available: readonly CliCredentialType[]) =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* promptSelect<CliCredentialType>(
        "Filter by type",
        available.map((entry) => ({ value: entry, label: entry })),
      );
    }
    if (!isType(raw)) {
      return yield* new InvalidArgumentError({ message: `Invalid type "${raw}"` });
    }
    return raw;
  });
