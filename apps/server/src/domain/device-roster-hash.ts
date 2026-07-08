import { canonicalDeviceRoster } from "@better-update/api";
import { Effect } from "effect";

import { CryptoService } from "./crypto-service";

import type { CryptoError } from "./crypto-service";

/**
 * Fingerprint a device roster by its UDIDs (normalized + deduped via
 * `canonicalDeviceRoster`). The CLI computes the same hash over the roster it
 * bakes into a provisioning profile, so equality means "profile still covers
 * the registered devices".
 */
export const computeDeviceRosterHash = (
  udids: readonly string[],
): Effect.Effect<string, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    return yield* service.sha256Hex(canonicalDeviceRoster(udids));
  });
