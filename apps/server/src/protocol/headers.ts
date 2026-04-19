import { Data, Effect } from "effect";
import { parseDictionary, serializeDictionary } from "structured-headers";

import { BadRequest } from "../errors";

const getHeaderOrUndefined = (headers: Headers, name: string): string | undefined => {
  const value = headers.get(name);
  return value === null ? undefined : value;
};

export interface ProtocolHeaders {
  readonly protocolVersion: 1;
  readonly platform: "ios" | "android";
  readonly runtimeVersion: string;
  readonly channelName: string;
  readonly expectSignature: string | undefined;
  readonly easClientId: string | undefined;
  readonly accept: string | undefined;
  readonly currentUpdateId: string | undefined;
  readonly extraParams: string | undefined;
}

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

export const buildManifestFiltersHeader = (scopeKey: string): string =>
  serializeDictionary(new Map([["scopekey", [scopeKey, new Map()]]]));

export const addServerDefinedHeaders = (
  response: Response,
  extraParams: string | undefined,
): Response => {
  if (!extraParams) {
    return response;
  }
  response.headers.set("expo-server-defined-headers", `expo-extra-params=:${btoa(extraParams)}:`);
  return response;
};

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

    return {
      protocolVersion: 1 as const,
      platform,
      runtimeVersion,
      channelName,
      expectSignature: getHeaderOrUndefined(headers, "expo-expect-signature"),
      easClientId: getHeaderOrUndefined(headers, "eas-client-id"),
      accept: getHeaderOrUndefined(headers, "accept"),
      currentUpdateId: getHeaderOrUndefined(headers, "expo-current-update-id"),
      extraParams,
    };
  });
