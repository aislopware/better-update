import { it } from "@effect/vitest";

import {
  CLI_ENVELOPE_VERSION,
  makeErrorEnvelope,
  makeSuccessEnvelope,
  serializeEnvelope,
} from "./envelope";

describe("envelope schema version", () => {
  it("is pinned to 1 (bumping the schema must be a deliberate, test-touching change)", () => {
    expect(CLI_ENVELOPE_VERSION).toBe(1);
  });
});

describe("success envelope", () => {
  it("wraps data as { schemaVersion, ok:true, command, data }", () => {
    const env = makeSuccessEnvelope("devices.list", { items: [], total: 0 });
    expect(env).toStrictEqual({
      schemaVersion: 1,
      ok: true,
      command: "devices.list",
      data: { items: [], total: 0 },
    });
  });

  it("key set is exactly the documented shape", () => {
    const env = makeSuccessEnvelope("whoami", { id: "u1" });
    expect(Object.keys(env).toSorted()).toStrictEqual(["command", "data", "ok", "schemaVersion"]);
  });
});

describe("error envelope", () => {
  it("produces { schemaVersion, ok:false, command, error:{code,tag,message} }", () => {
    const env = makeErrorEnvelope("update.publish", {
      code: 2,
      tag: "InteractiveProhibitedError",
      message: "Provide the value via a flag.",
    });
    expect(env).toStrictEqual({
      schemaVersion: 1,
      ok: false,
      command: "update.publish",
      error: {
        code: 2,
        tag: "InteractiveProhibitedError",
        message: "Provide the value via a flag.",
      },
    });
  });

  it("includes hint only when provided", () => {
    const withHint = makeErrorEnvelope("credentials.view", {
      code: 1,
      tag: "MissingCredentialsError",
      message: "No credentials found.",
      hint: "Run `better-update credentials configure` first.",
    });
    expect(withHint.error.hint).toBe("Run `better-update credentials configure` first.");

    const withoutHint = makeErrorEnvelope("devices.list", {
      code: 1,
      tag: "NotFound",
      message: "Not found.",
    });
    expect("hint" in withoutHint.error).toBe(false);
  });

  it("omits hint when passed an explicit undefined", () => {
    const env = makeErrorEnvelope("x", {
      code: 1,
      tag: "Unknown",
      message: "m",
      hint: undefined,
    });
    expect("hint" in env.error).toBe(false);
  });

  it("key set is exactly the documented shape", () => {
    const env = makeErrorEnvelope("x", { code: 1, tag: "Unknown", message: "m" });
    expect(Object.keys(env).toSorted()).toStrictEqual(["command", "error", "ok", "schemaVersion"]);
    expect(Object.keys(env.error).toSorted()).toStrictEqual(["code", "message", "tag"]);
  });
});

describe("envelope serialization", () => {
  it("yields single-line compact JSON that round-trips", () => {
    const env = makeSuccessEnvelope("devices.view", { id: "d1", name: "iPhone" });
    const serialized = serializeEnvelope(env);
    expect(serialized).not.toContain("\n");
    expect(serialized).toBe(
      '{"schemaVersion":1,"ok":true,"command":"devices.view","data":{"id":"d1","name":"iPhone"}}',
    );
    expect(JSON.parse(serialized)).toStrictEqual(env);
  });

  it("serializes error envelopes single-line and round-trips", () => {
    const env = makeErrorEnvelope("login", {
      code: 3,
      tag: "AuthRequiredError",
      message: "Not authenticated.",
    });
    const serialized = serializeEnvelope(env);
    expect(serialized).not.toContain("\n");
    expect(JSON.parse(serialized)).toStrictEqual(env);
  });
});
