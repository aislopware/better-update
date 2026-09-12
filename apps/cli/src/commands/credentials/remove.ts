import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  deleteCredential,
  filterCredentials,
  listAllCredentials,
} from "../../lib/credentials-manager";
import { InvalidArgumentError } from "../../lib/exit-codes";
import { printHuman } from "../../lib/output";
import { optionalFlag, yesFlag } from "../../lib/params";
import { promptConfirm, promptSelect } from "../../lib/prompts";
import { runCommand } from "../../lib/run-command";
import { apiClient } from "../../services/api-client";

import type {
  CliCredentialPlatform,
  CliCredentialRow,
  CliCredentialType,
} from "../../lib/credentials-manager";

const CREDENTIAL_TYPES = [
  "distribution-certificate",
  "macos-certificate",
  "provisioning-profile",
  "push-key",
  "push-certificate",
  "apple-pay-certificate",
  "pass-type-certificate",
  "asc-api-key",
  "keystore",
  "google-service-account-key",
] as const;

const isPlatform = (value: string): value is CliCredentialPlatform =>
  value === "ios" || value === "android" || value === "macos";

const isType = (value: string): value is CliCredentialType =>
  (CREDENTIAL_TYPES as readonly string[]).includes(value);

const formatRowLabel = (row: CliCredentialRow): string => {
  // Lead with the user label when present, else the natural identifier; keystores
  // sharing an alias are told apart by their distinct `--name`.
  const label = row.name ? `${row.name} (${row.identifier})` : row.identifier;
  const distro = row.distribution ? ` (${row.distribution})` : "";
  return `${row.type}: ${label}${distro} — ${row.id.slice(0, 8)}…`;
};

export const removeCommand = Command.make(
  "remove",
  {
    platform: Flag.Literals("platform", ["ios", "android", "macos"]).pipe(
      Flag.withDescription("Pre-filter by platform"),
      optionalFlag,
    ),
    type: Flag.Literals("type", [...CREDENTIAL_TYPES]).pipe(
      Flag.withDescription("Pre-filter by credential type"),
      optionalFlag,
    ),
    yes: yesFlag("Skip the final confirmation prompt"),
  },
  Effect.fn(
    function* (args) {
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
    },
    runCommand({ json: "value" }),
  ),
).pipe(
  Command.withDescription(
    "Interactively pick a credential to delete (uses prompts to narrow the choice)",
  ),
);

const resolvePlatform = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return yield* promptSelect<CliCredentialPlatform>("Filter by platform", [
        { value: "ios", label: "iOS" },
        { value: "android", label: "Android" },
        { value: "macos", label: "macOS" },
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
