import { parseExpectSignatureHeader } from "@better-update/expo-codesign";
import { Data, Effect } from "effect";
import { parseDictionary } from "structured-headers";

import { BadRequest } from "../errors";
import { parseRecentFailedUpdateIds } from "./sfv";

const getHeaderOrUndefined = (headers: Headers, name: string): string | undefined => {
  const value = headers.get(name);
  return value === null ? undefined : value;
};

// NOTE: scopeKey is NOT a request header — the device never sends it. The
// server derives it from the project's configured update URL via
// domain/scope-key.ts. Do not add a header read for it here. `extraParams`
// (expo-extra-params) is the only inbound server-defined-headers signal the
// client resends; it is captured below.
export interface ProtocolHeaders {
  readonly protocolVersion: 1;
  readonly platform: "ios" | "android";
  readonly runtimeVersion: string;
  readonly channelName: string;
  // Presence of `expo-expect-signature` toggles serving the stored signature +
  // certificate_chain. Algorithm enforcement (rsa-v1_5-sha256 only; ECDSA
  // rejected) lives at PUBLISH time in domain/signed-update-verification.ts, NOT
  // here — anything stored is already verified, so the serve path only needs the
  // presence signal (`expectSignature`).
  readonly expectSignature: string | undefined;
  // The `alg` / `keyid` the device requests via the `expo-expect-signature` SFV
  // dictionary, parsed (total/never-throws) via @better-update/expo-codesign.
  // BEST-EFFORT negotiation metadata only — the real algorithm gate is the
  // publish-time verify, so a malformed or non-rsa-v1_5-sha256 request here never
  // fails the serve request; these fields are exposed for telemetry/negotiation.
  readonly expectSignatureAlg: string | undefined;
  readonly expectSignatureKeyId: string | undefined;
  readonly easClientId: string | undefined;
  readonly accept: string | undefined;
  readonly currentUpdateId: string | undefined;
  readonly extraParams: string | undefined;
  // Implementation-defined extras BEYOND the expo-updates-1 spec, used for
  // anti-brick selection + crash telemetry. Both are best-effort/optional and
  // never fail the request — a malformed value degrades to the safe default.
  //
  // `Expo-Recent-Failed-Update-IDs`: SFV-0 list of update ids the device just
  // reported as failed; parsed (lowercased, capped at 5) so selection can skip
  // them. Defaults to [] when the header is absent.
  readonly recentFailedUpdateIds: readonly string[];
  // `Expo-Fatal-Error`: raw crash string from the device, clamped to 1024 chars
  // to mirror the client clamp and bound storage/log size. undefined when absent.
  readonly fatalError: string | undefined;
}

const MAX_FATAL_ERROR_CHARS = 1024;

const parseFatalError = (headers: Headers): string | undefined => {
  const raw = getHeaderOrUndefined(headers, "expo-fatal-error");
  return raw === undefined ? undefined : raw.slice(0, MAX_FATAL_ERROR_CHARS);
};

// `eas-client-id` is an unbounded, client-controlled request header. It is used
// to build the Analytics Engine index `${projectId}:${easClientId}`, which
// Cloudflare caps at 96 bytes. A normal value is a 36-char UUID; bound it so a
// malicious oversized header can never blow the AE index limit (the telemetry
// write is also try/catch-isolated in createTracker, but bounding at the source
// is the cheaper, first line of defense). The composite index is
// `${projectId}:${easClientId}`, and projectId is a 36-char crypto.randomUUID
// (see handlers/projects.ts). Budget: 36 (projectId) + 1 (':') + this cap must
// stay <= 96, so the cap is 58 (36 + 1 + 58 = 95 <= 96). Both projectId (UUID)
// and a normal easClientId are ASCII, so char count == byte count here.
const MAX_EAS_CLIENT_ID_CHARS = 58;

const parseEasClientId = (headers: Headers): string | undefined => {
  const raw = getHeaderOrUndefined(headers, "eas-client-id");
  return raw === undefined ? undefined : raw.slice(0, MAX_EAS_CLIENT_ID_CHARS);
};

const requireHeader = (headers: Headers, name: string, label: string) => {
  const value = headers.get(name);
  return value
    ? Effect.succeed(value)
    : Effect.fail(new BadRequest({ message: `Missing required header: ${label}` }));
};

type Platform = ProtocolHeaders["platform"];

const parsePlatform = (value: string): Effect.Effect<Platform, BadRequest> =>
  value === "ios" || value === "android"
    ? Effect.succeed(value)
    : Effect.fail(new BadRequest({ message: `Invalid platform: ${value}` }));

const MAX_EXTRA_PARAM_KEYS = 16;
const MAX_EXTRA_PARAM_VALUE_BYTES = 256;
const textEncoder = new TextEncoder();

class ProtocolExtraParamsParseError extends Data.TaggedError("ProtocolExtraParamsParseError")<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const parseExtraParams = (headers: Headers) =>
  Effect.gen(function* () {
    const raw = headers.get("expo-extra-params");
    if (!raw) {
      return undefined;
    }
    const dict = yield* Effect.try({
      try: () => parseDictionary(raw),
      catch: (cause) =>
        new ProtocolExtraParamsParseError({
          message: "Invalid expo-extra-params header",
          cause,
        }),
    });
    if (dict.size > MAX_EXTRA_PARAM_KEYS) {
      return undefined;
    }
    const hasOversized = [...dict.values()].some(
      ([value]) =>
        typeof value === "string" &&
        textEncoder.encode(value).byteLength > MAX_EXTRA_PARAM_VALUE_BYTES,
    );
    return hasOversized ? undefined : raw;
  }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

export const parseProtocolHeaders = (
  headers: Headers,
): Effect.Effect<ProtocolHeaders, BadRequest> =>
  Effect.gen(function* () {
    const version = yield* requireHeader(headers, "expo-protocol-version", "expo-protocol-version");
    if (version !== "1") {
      yield* Effect.fail(new BadRequest({ message: `Unsupported protocol version: ${version}` }));
    }

    const rawPlatform = yield* requireHeader(headers, "expo-platform", "expo-platform");
    const platform = yield* parsePlatform(rawPlatform);

    const runtimeVersion = yield* requireHeader(
      headers,
      "expo-runtime-version",
      "expo-runtime-version",
    );
    const channelName = yield* requireHeader(headers, "expo-channel-name", "expo-channel-name");
    const extraParams = yield* parseExtraParams(headers);

    // Parse the requested alg/keyid from the `expo-expect-signature` SFV
    // dictionary (best-effort, total). Presence still gates serving; the alg the
    // device requests is exposed for negotiation/telemetry but NOT enforced here
    // (publish-time verify is the real gate).
    const rawExpectSignature = getHeaderOrUndefined(headers, "expo-expect-signature");
    const expectSignatureParsed =
      rawExpectSignature === undefined ? {} : parseExpectSignatureHeader(rawExpectSignature);

    return {
      protocolVersion: 1 as const,
      platform,
      runtimeVersion,
      channelName,
      expectSignature: rawExpectSignature,
      expectSignatureAlg: expectSignatureParsed.alg,
      expectSignatureKeyId: expectSignatureParsed.keyid,
      easClientId: parseEasClientId(headers),
      accept: getHeaderOrUndefined(headers, "accept"),
      currentUpdateId: getHeaderOrUndefined(headers, "expo-current-update-id"),
      extraParams,
      recentFailedUpdateIds: parseRecentFailedUpdateIds(
        getHeaderOrUndefined(headers, "expo-recent-failed-update-ids"),
      ),
      fatalError: parseFatalError(headers),
    };
  });
