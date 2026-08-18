import { runWithEnv } from "../../tests/helpers/runtime";
import { manifestRuntime } from "./manifest-runtime";

import type { ProtocolHeaders } from "../protocol/headers";

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

const headers = (overrides: Partial<ProtocolHeaders> = {}): ProtocolHeaders => ({
  protocolVersion: 1,
  platform: "ios",
  runtimeVersion: "1.0.0",
  channelName: "production",
  channelDefaulted: false,
  expectSignature: undefined,
  expectSignatureAlg: undefined,
  expectSignatureKeyId: undefined,
  easClientId: "device-1",
  accept: undefined,
  currentUpdateId: undefined,
  extraParams: undefined,
  recentFailedUpdateIds: [],
  fatalError: undefined,
  ...overrides,
});

const trackOnce = async (ph: ProtocolHeaders) => {
  const points: { indexes: string[]; blobs: string[]; doubles: number[] }[] = [];
  const env = {
    ASSET_CDN_URL: "https://cdn.example.com",
    PUBLIC_API_URL: "https://api.example.com",
    ANALYTICS: {
      writeDataPoint: (point: { indexes: string[]; blobs: string[]; doubles: number[] }) => {
        points.push(point);
      },
    },
    // `provideCloudflareEnv` opens a D1 read-replication session per call.
    DB: { withSession: () => ({}) },
  } as unknown as Env;

  const runtime = await runWithEnv(manifestRuntime, env);
  runtime.createTracker({ projectId: PROJECT_ID, ph, startTime: Date.now() })(
    "branch-1",
    "update-1",
    "manifest",
  );
  return points[0];
};

describe("manifest tracker", () => {
  it("indexes a device by its client id", async () => {
    const point = await trackOnce(headers());

    expect(point?.indexes[0]).toBe(`${PROJECT_ID}:device-1`);
  });

  // A random id per request would make every header-less request its own
  // `COUNT(DISTINCT index1)` row, reporting unique devices equal to requests.
  it("buckets requests with no client id under one anonymous key per project", async () => {
    const first = await trackOnce(headers({ easClientId: undefined }));
    const second = await trackOnce(headers({ easClientId: undefined }));

    expect(first?.indexes[0]).toBe(`${PROJECT_ID}:anonymous`);
    expect(second?.indexes[0]).toBe(first?.indexes[0]);
  });

  it("flags a request that reported a prior fatal error", async () => {
    const clean = await trackOnce(headers());
    const crashed = await trackOnce(
      headers({ fatalError: "TypeError: undefined is not a function" }),
    );

    expect(clean?.doubles[1]).toBe(0);
    expect(crashed?.doubles[1]).toBe(1);
    expect(crashed?.blobs[8]).toBe("TypeError: undefined is not a function");
  });
});
