import { Schema } from "effect";

import {
  AdoptionResult,
  AnalyticsParams,
  ChannelAnalyticsResult,
  PlatformAnalyticsResult,
  UpdateAnalyticsResult,
} from "./analytics";

describe(AnalyticsParams, () => {
  test("decodes valid params", () => {
    const result = Schema.decodeUnknownSync(AnalyticsParams)({
      projectId: "proj-1",
    });
    expect(result).toEqual({ projectId: "proj-1" });
  });

  test("rejects missing projectId", () => {
    expect(() => Schema.decodeUnknownSync(AnalyticsParams)({})).toThrow();
  });
});

describe(AdoptionResult, () => {
  test("decodes valid result", () => {
    const result = Schema.decodeUnknownSync(AdoptionResult)({
      entries: [{ updateId: "u1", groupId: "g1", adoptionRate: 0.85, deviceCount: 1000 }],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.adoptionRate).toBe(0.85);
  });

  test("accepts empty entries", () => {
    const result = Schema.decodeUnknownSync(AdoptionResult)({ entries: [] });
    expect(result.entries).toHaveLength(0);
  });
});

describe(UpdateAnalyticsResult, () => {
  test("decodes valid result", () => {
    const result = Schema.decodeUnknownSync(UpdateAnalyticsResult)({
      entries: [{ updateId: "u1", downloads: 500, applies: 450, errors: 3 }],
    });
    expect(result.entries[0]?.downloads).toBe(500);
  });
});

describe(ChannelAnalyticsResult, () => {
  test("decodes valid result", () => {
    const result = Schema.decodeUnknownSync(ChannelAnalyticsResult)({
      entries: [{ channelId: "ch-1", channelName: "production", activeDevices: 2000 }],
    });
    expect(result.entries[0]?.channelName).toBe("production");
  });
});

describe(PlatformAnalyticsResult, () => {
  test("decodes valid result", () => {
    const result = Schema.decodeUnknownSync(PlatformAnalyticsResult)({
      entries: [
        { platform: "ios", deviceCount: 3000, percentage: 60 },
        { platform: "android", deviceCount: 2000, percentage: 40 },
      ],
    });
    expect(result.entries).toHaveLength(2);
  });
});
