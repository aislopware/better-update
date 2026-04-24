import { Data, Effect } from "effect";

import { pemToPkcs8Der } from "../lib/apple-pem";
import { toDbNull } from "../lib/nullable";
import {
  APPLE_ISSUER_ID_PATTERN,
  APPLE_KEY_ID_PATTERN,
  APPLE_TEAM_ID_PATTERN,
} from "./apple-identifiers";

export class InvalidAscApiKey extends Data.TaggedError("InvalidAscApiKey")<{
  readonly message: string;
}> {}

export interface AscApiKeyMetadata {
  readonly keyId: string;
  readonly issuerId: string;
  readonly name: string;
  readonly pem: string;
  readonly appleTeamId?: string;
  readonly roles?: readonly string[];
}

export const validateAscApiKey = (metadata: AscApiKeyMetadata) =>
  Effect.gen(function* () {
    if (!APPLE_KEY_ID_PATTERN.test(metadata.keyId)) {
      return yield* Effect.fail(
        new InvalidAscApiKey({
          message: "ASC API Key ID must be 10 uppercase alphanumeric characters",
        }),
      );
    }
    if (!APPLE_ISSUER_ID_PATTERN.test(metadata.issuerId)) {
      return yield* Effect.fail(new InvalidAscApiKey({ message: "Issuer ID must be a UUID" }));
    }
    if (metadata.name.trim().length === 0 || metadata.name.length > 120) {
      return yield* Effect.fail(new InvalidAscApiKey({ message: "Name must be 1-120 characters" }));
    }
    if (metadata.appleTeamId !== undefined && !APPLE_TEAM_ID_PATTERN.test(metadata.appleTeamId)) {
      return yield* Effect.fail(
        new InvalidAscApiKey({
          message: "Apple Team identifier must be 10 uppercase alphanumeric characters",
        }),
      );
    }
    const der = pemToPkcs8Der(metadata.pem);
    if (der === null) {
      return yield* Effect.fail(
        new InvalidAscApiKey({ message: "ASC API key is not a valid PKCS8 PEM" }),
      );
    }
    return {
      keyId: metadata.keyId,
      issuerId: metadata.issuerId,
      name: metadata.name.trim(),
      appleTeamId: toDbNull(metadata.appleTeamId),
      roles: metadata.roles ?? [],
      derBytes: der,
    };
  });
