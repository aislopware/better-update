import {
  deriveRecipient,
  fingerprint,
  generateIdentity,
  sealIdentity,
} from "@better-update/credentials-crypto";
import { Effect } from "effect";

import type { Identity, IdentityFile } from "@better-update/credentials-crypto";

import { IdentityError } from "../lib/exit-codes";
import { CliRuntime } from "../services/cli-runtime";
import { IdentityStore } from "../services/identity-store";

import type { ApiClient } from "../services/api-client";

/** The recipient the CLI would encrypt to right now, and where it came from. */
export interface ActiveRecipient {
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly source: "env" | "file";
}

/**
 * Generate, seal, and persist a fresh device identity. Fails if one already
 * exists — replacing a key orphans every credential wrapped to it until an admin
 * re-grants access, so that is a deliberate, separate action, not a silent
 * overwrite.
 */
export const createLocalIdentity = (
  passphrase: string,
): Effect.Effect<Identity, IdentityError, IdentityStore> =>
  Effect.gen(function* () {
    const store = yield* IdentityStore;
    const existing = yield* store.load;
    if (existing !== null) {
      return yield* new IdentityError({
        message:
          "An identity already exists at ~/.better-update/identity.json. Remove it to create a new device key (you will lose access to credentials wrapped to the old key until an admin re-grants it).",
      });
    }
    const identity = yield* Effect.promise(async () => generateIdentity());
    const file = yield* Effect.promise(async () =>
      sealIdentity({ privateKey: identity.privateKey, passphrase }),
    );
    yield* store.save(file);
    return identity;
  });

/** Load the on-disk identity envelope, failing with guidance if none is set up. */
export const loadIdentityFileOrFail: Effect.Effect<IdentityFile, IdentityError, IdentityStore> =
  Effect.gen(function* () {
    const store = yield* IdentityStore;
    const file = yield* store.load;
    if (file === null) {
      return yield* new IdentityError({
        message: "No identity found. Run `better-update credentials identity create` first.",
      });
    }
    return file;
  });

/**
 * The recipient kind implied by where the identity came from. An identity loaded
 * from `BETTER_UPDATE_IDENTITY` (env) is a CI **machine** recipient — org-owned,
 * with no user session; an on-disk identity is a user-owned **device**. Picking
 * the wrong kind is rejected by the server (a device key requires a user session,
 * which a token-authenticated CI run does not have).
 */
export const recipientKind = (source: ActiveRecipient["source"]): "device" | "machine" =>
  source === "env" ? "machine" : "device";

/**
 * Register a public recipient on the server. `device` keys are the caller's own
 * (self-service); `machine` keys are org-owned CI keys (admin-gated). The kind
 * follows the identity's source — see {@link recipientKind}.
 */
export const registerRecipient = (
  api: ApiClient,
  args: {
    readonly kind: "device" | "machine";
    readonly publicKey: string;
    readonly fingerprint: string;
    readonly label: string;
  },
) =>
  api.userEncryptionKeys.register({
    payload: {
      kind: args.kind,
      publicKey: args.publicKey,
      label: args.label,
      fingerprint: args.fingerprint,
    },
  });

/**
 * The recipient the CLI would encrypt to right now: the `BETTER_UPDATE_IDENTITY`
 * env key (CI) takes precedence over the on-disk device identity. Neither path
 * needs a passphrase — only the public half is resolved.
 */
export const activeRecipient: Effect.Effect<
  ActiveRecipient,
  IdentityError,
  CliRuntime | IdentityStore
> = Effect.gen(function* () {
  const runtime = yield* CliRuntime;
  const envKey = yield* runtime.getEnv("BETTER_UPDATE_IDENTITY");
  if (envKey !== undefined && envKey.length > 0) {
    const publicKey = yield* Effect.tryPromise({
      try: async () => deriveRecipient(envKey),
      catch: () =>
        new IdentityError({ message: "BETTER_UPDATE_IDENTITY is not a valid age identity key." }),
    });
    return { publicKey, fingerprint: fingerprint(publicKey), source: "env" as const };
  }
  const file = yield* loadIdentityFileOrFail;
  return { publicKey: file.publicKey, fingerprint: file.fingerprint, source: "file" as const };
});
