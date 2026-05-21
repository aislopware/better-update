import { Console, Effect } from "effect";

import type { CommandExecutor, FileSystem } from "@effect/platform";

import { IOS_DISTRIBUTION_TO_TYPE } from "../lib/credentials-downloader";
import {
  deleteCredential,
  filterCredentials,
  listAllCredentials,
} from "../lib/credentials-manager";
import { MissingCredentialsError } from "../lib/exit-codes";
import { promptConfirm, promptSelect } from "../lib/prompts";

import type { IosDistribution } from "../lib/build-profile";
import type { CliCredentialRow } from "../lib/credentials-manager";
import type { InteractiveMode } from "../lib/interactive-mode";
import type { OutputMode } from "../lib/output-mode";
import type { ApiClient } from "../services/api-client";
import type { AppleAuth } from "../services/apple-auth";
import type { CliRuntime } from "../services/cli-runtime";
import type { IdentityStore } from "../services/identity-store";

export const APPLE_PUSH_KEY_PORTAL_URL =
  "https://developer.apple.com/account/resources/authkeys/list";

export const DISTRIBUTION_OPTIONS: readonly {
  readonly value: IosDistribution;
  readonly label: string;
}[] = [
  { value: "ad-hoc", label: "Ad Hoc (internal testers)" },
  { value: "app-store", label: "App Store" },
  { value: "development", label: "Development" },
  { value: "enterprise", label: "Enterprise" },
];

export interface WizardContext {
  readonly api: ApiClient;
  readonly projectId: string;
  readonly iosBundleId: string | undefined;
  readonly androidPackage: string | undefined;
}

export const BACK = "__back__" as const;
export const EXIT = "__exit__" as const;

export type MenuEffect = Effect.Effect<
  void,
  never,
  | AppleAuth
  | CliRuntime
  | CommandExecutor.CommandExecutor
  | FileSystem.FileSystem
  | IdentityStore
  | InteractiveMode
  | OutputMode
>;

export const announce = (heading: string) =>
  Effect.gen(function* () {
    yield* Console.log("");
    yield* Console.log(`── ${heading} ──`);
  });

export const reportError = (label: string, cause: unknown) =>
  Console.log(`✗ ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);

export const safely = <Value, Err, Req>(
  label: string,
  effect: Effect.Effect<Value, Err, Req>,
): Effect.Effect<void, never, Req> =>
  effect.pipe(
    Effect.catchAll((cause) => reportError(label, cause)),
    Effect.asVoid,
  );

export const safePrompt = (effect: Effect.Effect<string, unknown, InteractiveMode>) =>
  effect.pipe(Effect.catchAll(() => Effect.succeed(BACK as string)));

export const promptForBundleConfig = (ctx: WizardContext) =>
  Effect.gen(function* () {
    const list = yield* ctx.api.iosBundleConfigurations.list({
      path: { projectId: ctx.projectId },
    });
    if (list.items.length === 0) {
      return yield* new MissingCredentialsError({
        message: "No iOS bundle configurations registered yet.",
        hint: "Run 'Set up project credentials' first to create one.",
      });
    }
    if (list.items.length === 1) {
      const [only] = list.items;
      if (only !== undefined) {
        return only;
      }
    }
    const choice = yield* promptSelect<string>(
      "Select an iOS bundle configuration",
      list.items.map((item) => ({
        value: item.id,
        label: `${item.bundleIdentifier} (${item.distributionType})`,
      })),
    );
    const found = list.items.find((item) => item.id === choice);
    if (!found) {
      return yield* new MissingCredentialsError({
        message: "Selected bundle configuration not found.",
        hint: "Retry.",
      });
    }
    return found;
  });

const IOS_DISTRIBUTION_VALUES = ["ad-hoc", "app-store", "development", "enterprise"] as const;

const isIosDistribution = (value: string): value is IosDistribution =>
  (IOS_DISTRIBUTION_VALUES as readonly string[]).includes(value);

export const matchDistribution = (raw: string): IosDistribution => {
  for (const [key, value] of Object.entries(IOS_DISTRIBUTION_TO_TYPE)) {
    if (value === raw && isIosDistribution(key)) {
      return key;
    }
  }
  return "app-store";
};

const TYPE_LABELS: Record<string, string> = {
  "distribution-certificate": "iOS distribution certificate",
  "provisioning-profile": "iOS provisioning profile",
  "push-key": "APNs push key",
  "asc-api-key": "ASC API key",
  keystore: "Android keystore",
  "google-service-account-key": "Google service account key",
};

const formatRowLabel = (row: CliCredentialRow): string => `${row.name} (${row.id.slice(0, 8)}…)`;

export type DeletableType =
  | "distribution-certificate"
  | "provisioning-profile"
  | "push-key"
  | "asc-api-key"
  | "keystore"
  | "google-service-account-key";

export const pickAndDelete = (ctx: WizardContext, type: DeletableType, humanLabel: string) =>
  Effect.gen(function* () {
    const rows = yield* listAllCredentials(ctx.api);
    const matches = filterCredentials(rows, { type });
    if (matches.length === 0) {
      return yield* Console.log(`No ${humanLabel} entries found.`);
    }
    const id = yield* promptSelect<string>(
      `Select a ${humanLabel} to delete`,
      matches.map((row) => ({ value: row.id, label: formatRowLabel(row) })),
    );
    const chosen = matches.find((row) => row.id === id);
    if (!chosen) {
      return yield* Console.log("Selection lost — try again.");
    }
    const confirmed = yield* promptConfirm(
      `Delete ${TYPE_LABELS[type] ?? type} ${id.slice(0, 8)}…? This cannot be undone.`,
      { initialValue: false },
    );
    if (!confirmed) {
      return yield* Console.log("Aborted.");
    }
    yield* deleteCredential(ctx.api, { id, platform: chosen.platform, type });
    return yield* Console.log(`Deleted ${humanLabel} ${id}.`);
  });
