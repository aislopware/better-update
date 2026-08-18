import { trackDelivery } from "./delivery-runtime";

import type { BundleResolution } from "../application/resolve-bundle";
import type { PatchRequest } from "../protocol/patch-negotiation";
import type { StoredBlob } from "../repositories/bundle";

const patchRequest = (overrides: Partial<PatchRequest> = {}): PatchRequest => ({
  supportsBsdiff: true,
  currentUpdateId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  embeddedUpdateId: undefined,
  requestedUpdateId: undefined,
  runtimeVersion: "1.0.0",
  platform: "ios",
  ...overrides,
});

// Only `size` matters here; the rest of the R2 metadata rides along untouched.
const blob = (size: number): StoredBlob => ({
  body: null,
  size,
  etag: null,
  contentType: null,
  uploaded: null,
  checksumSha256Base64: null,
});

const makeEnv = (writeDataPoint: (point: unknown) => void) =>
  ({ DELIVERY_ANALYTICS: { writeDataPoint } }) as unknown as Env;

const PROJECT_ID = "11111111-2222-3333-4444-555555555555";
const UPDATE_ID = "99999999-8888-7777-6666-555555555555";

const track = (resolution: BundleResolution, request = patchRequest()) => {
  const points: unknown[] = [];
  trackDelivery({
    env: makeEnv((point) => points.push(point)),
    projectId: PROJECT_ID,
    updateId: UPDATE_ID,
    request,
    resolution,
    startTime: Date.now(),
  });
  return points[0] as {
    indexes: string[];
    blobs: string[];
    doubles: number[];
  };
};

describe(trackDelivery, () => {
  it("records a patch with the base it was computed against and its size", () => {
    const point = track({ kind: "patch", baseUpdateId: "base-id", blob: blob(4096) });

    expect(point.blobs[3]).toBe("patch");
    expect(point.blobs[5]).toBe("base-id");
    expect(point.doubles[0]).toBe(4096);
  });

  it("records a full bundle with no base", () => {
    const point = track({ kind: "full", blob: blob(1_000_000) });

    expect(point.blobs[3]).toBe("full");
    expect(point.blobs[5]).toBe("");
    expect(point.doubles[0]).toBe(1_000_000);
  });

  // A 404 sent no body: it must not inflate bytes-served.
  it("records a miss as zero bytes", () => {
    const point = track({ kind: "not-found" });

    expect(point.blobs[3]).toBe("not_found");
    expect(point.doubles[0]).toBe(0);
  });

  // The hit-rate denominator: patches served over requests that could take one.
  it("records whether the client advertised bsdiff support", () => {
    expect(track({ kind: "full", blob: blob(1) }).blobs[6]).toBe("1");
    expect(
      track({ kind: "full", blob: blob(1) }, patchRequest({ supportsBsdiff: false })).blobs[6],
    ).toBe("0");
  });

  it("buckets a request with no current-update id under one anonymous key", () => {
    const point = track(
      { kind: "full", blob: blob(1) },
      patchRequest({ currentUpdateId: undefined }),
    );

    expect(point.indexes[0]).toBe(`${PROJECT_ID}:anonymous`);
  });

  // Telemetry may never fail a download — writeDataPoint can throw synchronously
  // on an Analytics Engine limit violation.
  it("swallows a throwing writeDataPoint", () => {
    expect(() => {
      trackDelivery({
        env: makeEnv(() => {
          throw new Error("AE limit exceeded");
        }),
        projectId: PROJECT_ID,
        updateId: UPDATE_ID,
        request: patchRequest(),
        resolution: { kind: "full", blob: blob(1) },
        startTime: Date.now(),
      });
    }).not.toThrow();
  });
});
