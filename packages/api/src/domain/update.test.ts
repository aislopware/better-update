import { Schema } from "effect";

import { CreateUpdateBody, UpdateRolloutBody } from "./update";

describe(CreateUpdateBody, () => {
  const validBody = {
    branch: "main",
    project: "@my/app",
    runtimeVersion: "1.0.0",
    platform: "ios",
    message: "Fix crash",
    groupId: "group-1",
    metadata: {},
    assets: [{ hash: "abc", key: "bundle.js", isLaunch: true }],
  };

  test("decodes valid body", () => {
    const result = Schema.decodeUnknownSync(CreateUpdateBody)(validBody);
    expect(result.platform).toBe("ios");
    expect(result.assets).toHaveLength(1);
  });

  test("accepts optional fields", () => {
    const result = Schema.decodeUnknownSync(CreateUpdateBody)({
      ...validBody,
      rolloutPercentage: 50,
      isRollback: true,
      signature: "sig",
    });
    expect(result.rolloutPercentage).toBe(50);
    expect(result.isRollback).toBe(true);
  });

  test("rejects empty branch", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateUpdateBody)({
        ...validBody,
        branch: "",
      }),
    ).toThrow();
  });

  test("rejects invalid platform", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateUpdateBody)({
        ...validBody,
        platform: "web",
      }),
    ).toThrow();
  });

  test("rejects rolloutPercentage below 1", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateUpdateBody)({
        ...validBody,
        rolloutPercentage: 0,
      }),
    ).toThrow();
  });

  test("rejects rolloutPercentage above 100", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateUpdateBody)({
        ...validBody,
        rolloutPercentage: 101,
      }),
    ).toThrow();
  });

  test("rejects non-integer rolloutPercentage", () => {
    expect(() =>
      Schema.decodeUnknownSync(CreateUpdateBody)({
        ...validBody,
        rolloutPercentage: 50.5,
      }),
    ).toThrow();
  });
});

describe(UpdateRolloutBody, () => {
  test("accepts valid percentage", () => {
    const result = Schema.decodeUnknownSync(UpdateRolloutBody)({
      percentage: 50,
    });
    expect(result.percentage).toBe(50);
  });

  test("accepts boundary values", () => {
    expect(Schema.decodeUnknownSync(UpdateRolloutBody)({ percentage: 1 })).toEqual({
      percentage: 1,
    });
    expect(Schema.decodeUnknownSync(UpdateRolloutBody)({ percentage: 100 })).toEqual({
      percentage: 100,
    });
  });

  test("rejects 0", () => {
    expect(() => Schema.decodeUnknownSync(UpdateRolloutBody)({ percentage: 0 })).toThrow();
  });

  test("rejects non-integer", () => {
    expect(() => Schema.decodeUnknownSync(UpdateRolloutBody)({ percentage: 33.3 })).toThrow();
  });
});
