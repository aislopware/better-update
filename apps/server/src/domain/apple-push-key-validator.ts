import { Data, Effect } from "effect";

import { pemToPkcs8Der } from "../lib/apple-pem";

export class InvalidApplePushKey extends Data.TaggedError("InvalidApplePushKey")<{
  readonly message: string;
}> {}

const KEY_ID_PATTERN = /^[A-Z0-9]{10}$/u;
const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/u;

export interface PushKeyMetadata {
  readonly keyId: string;
  readonly appleTeamId: string;
  readonly pem: string;
}

export const validatePushKey = (metadata: PushKeyMetadata) =>
  Effect.gen(function* () {
    if (!KEY_ID_PATTERN.test(metadata.keyId)) {
      return yield* Effect.fail(
        new InvalidApplePushKey({
          message: "Push Key ID must be 10 uppercase alphanumeric characters",
        }),
      );
    }
    if (!TEAM_ID_PATTERN.test(metadata.appleTeamId)) {
      return yield* Effect.fail(
        new InvalidApplePushKey({
          message: "Apple Team identifier must be 10 uppercase alphanumeric characters",
        }),
      );
    }
    const der = pemToPkcs8Der(metadata.pem);
    if (der === null) {
      return yield* Effect.fail(
        new InvalidApplePushKey({ message: "Push key is not a valid PKCS8 PEM" }),
      );
    }
    return {
      keyId: metadata.keyId,
      appleTeamId: metadata.appleTeamId,
      derBytes: der,
    };
  });
