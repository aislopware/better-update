import { Effect } from "effect";

import { addServerDefinedHeaders, parseProtocolHeaders } from "./headers";

const expectBadRequest = (error: { readonly _tag: string; readonly message: string }) => {
  expect(error).toMatchObject({ _tag: "BadRequest" });
};

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
      currentUpdateId: undefined,
      extraParams: undefined,
    });
  });

  test("missing expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-protocol-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  test("wrong expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-protocol-version", "0");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  test("invalid expo-platform fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-platform", "web");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  test("missing expo-runtime-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-runtime-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  test("missing expo-channel-name fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-channel-name");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
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

  test("valid extra params returns raw string", async () => {
    const headers = validHeaders();
    const raw = 'user-cohort="beta", flag=?1';
    headers.set("expo-extra-params", raw);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(raw);
  });

  test("malformed extra params returns undefined", async () => {
    const headers = validHeaders();
    headers.set("expo-extra-params", ";;;invalid");
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });

  test("extra params with exactly 16 keys returns raw string", async () => {
    const headers = validHeaders();
    const keys = Array.from({ length: 16 }, (_, idx) => `k${idx}=?1`).join(", ");
    headers.set("expo-extra-params", keys);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(keys);
  });

  test("extra params exceeding 16 keys returns undefined", async () => {
    const headers = validHeaders();
    const keys = Array.from({ length: 17 }, (_, idx) => `k${idx}=?1`).join(", ");
    headers.set("expo-extra-params", keys);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });

  test("extra params with string value of exactly 256 bytes returns raw string", async () => {
    const headers = validHeaders();
    const exactValue = "a".repeat(256);
    const raw = `key="${exactValue}"`;
    headers.set("expo-extra-params", raw);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(raw);
  });

  test("extra params with string value exceeding 256 bytes returns undefined", async () => {
    const headers = validHeaders();
    const longValue = "a".repeat(257);
    headers.set("expo-extra-params", `key="${longValue}"`);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });
});

describe(addServerDefinedHeaders, () => {
  test("returns same response when extraParams is undefined", () => {
    const response = new Response(null, { status: 204 });
    expect(addServerDefinedHeaders(response, undefined)).toBe(response);
  });

  test("sets expo-server-defined-headers with base64 byte sequence", async () => {
    const response = new Response("body", { status: 200 });
    const raw = 'cohort="beta"';
    const result = addServerDefinedHeaders(response, raw);
    expect(result.headers.get("expo-server-defined-headers")).toBe(
      `expo-extra-params=:${btoa(raw)}:`,
    );
    expect(result.status).toBe(200);
    expect(await result.text()).toBe("body");
  });

  test("preserves existing response headers", () => {
    const response = new Response(null, { status: 200, headers: { "x-custom": "keep" } });
    const result = addServerDefinedHeaders(response, "k=?1");
    expect(result.headers.get("x-custom")).toBe("keep");
    expect(result.headers.has("expo-server-defined-headers")).toBe(true);
  });
});
