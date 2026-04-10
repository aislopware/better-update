import { BadRequest } from "@better-update/api";
import { Effect } from "effect";

export interface ProtocolHeaders {
  readonly protocolVersion: 1;
  readonly platform: "ios" | "android";
  readonly runtimeVersion: string;
  readonly channelName: string;
  readonly expectSignature: string | undefined;
  readonly easClientId: string | undefined;
  readonly accept: string | undefined;
  readonly currentUpdateId: string | undefined;
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

    return {
      protocolVersion: 1 as const,
      platform,
      runtimeVersion,
      channelName,
      expectSignature: headers.get("expo-expect-signature") ?? undefined,
      easClientId: headers.get("eas-client-id") ?? undefined,
      accept: headers.get("accept") ?? undefined,
      currentUpdateId: headers.get("expo-current-update-id") ?? undefined,
    };
  });
