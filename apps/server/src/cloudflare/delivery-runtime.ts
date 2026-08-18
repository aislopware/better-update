import type { BundleResolution } from "../application/resolve-bundle";
import type { PatchRequest } from "../protocol/patch-negotiation";

// Delivery telemetry for the OTA bundle route.
//
// The manifest dataset answers "did a device ask, and what was it told". It
// cannot answer what actually crossed the wire, because the bundle download is
// a SEPARATE request with its own A-IM negotiation — a device can be handed a
// manifest and then take a 40 KB bsdiff patch, a 6 MB full bundle, or nothing
// at all, and `update_events` records the same row for all three. Non-launch
// assets are served straight off the CDN and are genuinely unobservable here;
// the launch bundle is not, because the manifest deliberately points it at the
// Worker so bsdiff negotiation can happen (see protocol/manifest-builder.ts).
//
// Same contract as the manifest tracker: fire-and-forget, never awaited, and a
// throw may never escape — serving a bundle must not depend on telemetry.

/** Sampling-key stand-in for a device that sent no current-update id. */
const ANONYMOUS_CLIENT_ID = "anonymous";

/** What the route ended up serving, as written to `blob4`. */
export type DeliveryKind = "patch" | "full" | "not_found";

const deliveryKind = (resolution: BundleResolution): DeliveryKind =>
  resolution.kind === "not-found" ? "not_found" : resolution.kind;

const deliveredBytes = (resolution: BundleResolution): number =>
  resolution.kind === "not-found" ? 0 : resolution.blob.size;

const baseUpdateId = (resolution: BundleResolution): string =>
  resolution.kind === "patch" ? resolution.baseUpdateId : "";

/**
 * Record one bundle-route delivery. Called after the resolution is known and
 * before the Response is handed back — `writeDataPoint` is deferred by Analytics
 * Engine design, so this adds no latency to the download.
 *
 * The index is the device's currently-launched update rather than a client id:
 * the bundle request carries no `EAS-Client-ID`, and `expo-current-update-id` is
 * the closest thing to a stable per-install key the route ever sees. It is
 * already a lowercased uuid (protocol/patch-negotiation.ts), so the composite
 * stays inside the 96-byte AE index cap.
 */
export const trackDelivery = (params: {
  readonly env: Env;
  readonly projectId: string;
  readonly updateId: string;
  readonly request: PatchRequest;
  readonly resolution: BundleResolution;
  readonly startTime: number;
}): void => {
  const { env, projectId, updateId, request, resolution } = params;
  // eslint-disable-next-line functional/no-try-statements -- Analytics Engine writeDataPoint may throw synchronously on a limit violation; delivery telemetry is best-effort and must never fail a bundle download
  try {
    env.DELIVERY_ANALYTICS.writeDataPoint({
      indexes: [`${projectId}:${request.currentUpdateId ?? ANONYMOUS_CLIENT_ID}`],
      blobs: [
        projectId,
        updateId,
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- Analytics Engine blob slot requires string; a pre-56.0.6 client sends no platform
        request.platform ?? "",
        deliveryKind(resolution),
        // eslint-disable-next-line eslint-js/no-restricted-syntax -- Analytics Engine blob slot requires string; a pre-56.0.6 client sends no runtime version
        request.runtimeVersion ?? "",
        baseUpdateId(resolution),
        // Whether the CLIENT offered to take a patch, independent of whether one
        // existed. Patch hit-rate is (patch deliveries / bsdiff-capable
        // requests), and without this the denominator is unknowable.
        request.supportsBsdiff ? "1" : "0",
      ],
      doubles: [deliveredBytes(resolution), Date.now() - params.startTime],
    });
  } catch {
    // Best-effort telemetry: drop the write, never break the download.
  }
};
