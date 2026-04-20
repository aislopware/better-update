import { safeJsonParse } from "@better-update/safe-json";
import { Data, Effect } from "effect";

export class InvalidGoogleServiceAccountKey extends Data.TaggedError(
  "InvalidGoogleServiceAccountKey",
)<{
  readonly message: string;
}> {}

export interface ParsedGoogleServiceAccountKey {
  readonly clientEmail: string;
  readonly privateKeyId: string;
  readonly googleProjectId: string;
  readonly privateKey: string;
}

interface RawKey {
  readonly type?: unknown;
  readonly project_id?: unknown;
  readonly private_key_id?: unknown;
  readonly private_key?: unknown;
  readonly client_email?: unknown;
}

const isString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export const parseGoogleServiceAccountKey = (jsonText: string) =>
  Effect.gen(function* () {
    const parsed = safeJsonParse(jsonText);
    if (parsed === null || typeof parsed !== "object") {
      return yield* Effect.fail(
        new InvalidGoogleServiceAccountKey({ message: "File is not valid JSON object" }),
      );
    }
    const raw = parsed as RawKey;
    if (raw.type !== "service_account") {
      return yield* Effect.fail(
        new InvalidGoogleServiceAccountKey({
          message: "type field must be 'service_account'",
        }),
      );
    }
    if (!isString(raw.project_id) || !isString(raw.private_key_id)) {
      return yield* Effect.fail(
        new InvalidGoogleServiceAccountKey({
          message: "project_id and private_key_id are required",
        }),
      );
    }
    if (!isString(raw.private_key) || !raw.private_key.includes("BEGIN PRIVATE KEY")) {
      return yield* Effect.fail(
        new InvalidGoogleServiceAccountKey({
          message: "private_key must be a PEM-formatted RSA key",
        }),
      );
    }
    if (!isString(raw.client_email) || !raw.client_email.includes("@")) {
      return yield* Effect.fail(
        new InvalidGoogleServiceAccountKey({
          message: "client_email must be a service-account email",
        }),
      );
    }
    const result: ParsedGoogleServiceAccountKey = {
      clientEmail: raw.client_email,
      privateKeyId: raw.private_key_id,
      googleProjectId: raw.project_id,
      privateKey: raw.private_key,
    };
    return result;
  });
