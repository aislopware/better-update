import { Effect } from "effect";

import { parseProtocolHeaders } from "./headers";

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
  it("valid headers returns ProtocolHeaders", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result).toStrictEqual({
      protocolVersion: 1,
      platform: "ios",
      runtimeVersion: "1.0.0",
      channelName: "production",
      expectSignature: undefined,
      expectSignatureAlg: undefined,
      expectSignatureKeyId: undefined,
      easClientId: undefined,
      accept: undefined,
      currentUpdateId: undefined,
      extraParams: undefined,
      recentFailedUpdateIds: [],
      fatalError: undefined,
    });
  });

  it("missing expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-protocol-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  it("wrong expo-protocol-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-protocol-version", "0");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  it("invalid expo-platform fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.set("expo-platform", "web");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  it("missing expo-runtime-version fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-runtime-version");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  it("missing expo-channel-name fails with BadRequest", async () => {
    const headers = validHeaders();
    headers.delete("expo-channel-name");
    const error = await Effect.runPromise(Effect.flip(parseProtocolHeaders(headers)));
    expectBadRequest(error);
  });

  it("optional headers absent returns undefined", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result.expectSignature).toBeUndefined();
    expect(result.easClientId).toBeUndefined();
    expect(result.accept).toBeUndefined();
  });

  it("optional headers present returns values", async () => {
    const headers = validHeaders();
    headers.set("expo-expect-signature", "sig-abc");
    headers.set("eas-client-id", "client-123");
    headers.set("accept", "multipart/mixed");
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.expectSignature).toBe("sig-abc");
    expect(result.easClientId).toBe("client-123");
    expect(result.accept).toBe("multipart/mixed");
  });

  it("eas-client-id is clamped to 58 chars so the AE index stays within 96 bytes", async () => {
    // The Analytics Engine index is `${projectId}:${easClientId}`; projectId is
    // a 36-char UUID + ':' separator, so easClientId is bounded so the composite
    // can never exceed AE's 96-byte cap (36 + 1 + 58 = 95).
    const headers = validHeaders();
    headers.set("eas-client-id", "c".repeat(200));
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.easClientId).toHaveLength(58);
  });

  it("parses alg + keyid from the expo-expect-signature SFV dictionary", async () => {
    const headers = validHeaders();
    const raw = 'sig, keyid="main", alg="rsa-v1_5-sha256"';
    headers.set("expo-expect-signature", raw);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    // Raw value is preserved for serve-time presence gating.
    expect(result.expectSignature).toBe(raw);
    expect(result.expectSignatureAlg).toBe("rsa-v1_5-sha256");
    expect(result.expectSignatureKeyId).toBe("main");
  });

  it("expo-expect-signature alg/keyid are undefined when the header is absent", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result.expectSignatureAlg).toBeUndefined();
    expect(result.expectSignatureKeyId).toBeUndefined();
  });

  it("malformed expo-expect-signature does not fail the request (alg/keyid undefined)", async () => {
    const headers = validHeaders();
    // A legal HTTP header value that is NOT a valid SFV dictionary.
    const malformed = "@@@not-a-dict@@@";
    headers.set("expo-expect-signature", malformed);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    // Still surfaces the raw value (presence) but yields no parsed alg/keyid.
    expect(result.expectSignature).toBe(malformed);
    expect(result.expectSignatureAlg).toBeUndefined();
    expect(result.expectSignatureKeyId).toBeUndefined();
  });

  it("valid extra params returns raw string", async () => {
    const headers = validHeaders();
    const raw = 'user-cohort="beta", flag=?1';
    headers.set("expo-extra-params", raw);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(raw);
  });

  it("malformed extra params returns undefined", async () => {
    const headers = validHeaders();
    headers.set("expo-extra-params", ";;;invalid");
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });

  it("extra params with exactly 16 keys returns raw string", async () => {
    const headers = validHeaders();
    const keys = Array.from({ length: 16 }, (_, idx) => `k${idx}=?1`).join(", ");
    headers.set("expo-extra-params", keys);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(keys);
  });

  it("extra params exceeding 16 keys returns undefined", async () => {
    const headers = validHeaders();
    const keys = Array.from({ length: 17 }, (_, idx) => `k${idx}=?1`).join(", ");
    headers.set("expo-extra-params", keys);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });

  it("extra params with string value of exactly 256 bytes returns raw string", async () => {
    const headers = validHeaders();
    const exactValue = "a".repeat(256);
    const raw = `key="${exactValue}"`;
    headers.set("expo-extra-params", raw);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBe(raw);
  });

  it("extra params with string value exceeding 256 bytes returns undefined", async () => {
    const headers = validHeaders();
    const longValue = "a".repeat(257);
    headers.set("expo-extra-params", `key="${longValue}"`);
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.extraParams).toBeUndefined();
  });

  it("Expo-Recent-Failed-Update-IDs present -> parsed lowercased id array", async () => {
    const headers = validHeaders();
    headers.set("expo-recent-failed-update-ids", '"ABC-123", "def-456"');
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.recentFailedUpdateIds).toStrictEqual(["abc-123", "def-456"]);
  });

  it("Expo-Recent-Failed-Update-IDs absent -> []", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result.recentFailedUpdateIds).toStrictEqual([]);
  });

  it("malformed Expo-Recent-Failed-Update-IDs -> [] (request still succeeds)", async () => {
    const headers = validHeaders();
    headers.set("expo-recent-failed-update-ids", '"unterminated');
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.recentFailedUpdateIds).toStrictEqual([]);
  });

  it("Expo-Fatal-Error present -> raw string", async () => {
    const headers = validHeaders();
    headers.set("expo-fatal-error", "TypeError: undefined is not a function");
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.fatalError).toBe("TypeError: undefined is not a function");
  });

  it("Expo-Fatal-Error exceeding 1024 chars -> clamped to 1024", async () => {
    const headers = validHeaders();
    headers.set("expo-fatal-error", "x".repeat(2000));
    const result = await Effect.runPromise(parseProtocolHeaders(headers));
    expect(result.fatalError).toHaveLength(1024);
  });

  it("Expo-Fatal-Error absent -> undefined", async () => {
    const result = await Effect.runPromise(parseProtocolHeaders(validHeaders()));
    expect(result.fatalError).toBeUndefined();
  });
});
