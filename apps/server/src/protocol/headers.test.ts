import { BadRequest } from "@better-update/api";
import { Effect } from "effect";

import { parseProtocolHeaders } from "./headers";

const validHeaders = () =>
  new Headers({
    "expo-protocol-version": "1",
    "expo-platform": "ios",
    "expo-runtime-version": "1.0.0",
    "expo-channel-name": "production",
  });

describe(parseProtocolHeaders, () => {
  test("valid headers returns ProtocolHeaders", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result).toEqual({
      protocolVersion: 1,
      platform: "ios",
      runtimeVersion: "1.0.0",
      channelName: "production",
      expectSignature: undefined,
      easClientId: undefined,
      accept: undefined,
    });
  });

  test("missing expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-protocol-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expect(error).toBeInstanceOf(BadRequest);
  });

  test("wrong expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-protocol-version", "0");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expect(error).toBeInstanceOf(BadRequest);
  });

  test("invalid expo-platform fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-platform", "web");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expect(error).toBeInstanceOf(BadRequest);
  });

  test("missing expo-runtime-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-runtime-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expect(error).toBeInstanceOf(BadRequest);
  });

  test("missing expo-channel-name fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-channel-name");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expect(error).toBeInstanceOf(BadRequest);
  });

  test("optional headers absent returns undefined", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result.expectSignature).toBeUndefined();
    expect(result.easClientId).toBeUndefined();
    expect(result.accept).toBeUndefined();
  });

  test("optional headers present returns values", async () => {
    const headers = validHeaders();
    headers.set("expo-expect-signature", "sig-abc");
    headers.set("eas-client-id", "client-123");
    headers.set("accept", "multipart/mixed");
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.expectSignature).toBe("sig-abc");
    expect(result.easClientId).toBe("client-123");
    expect(result.accept).toBe("multipart/mixed");
  });
});
