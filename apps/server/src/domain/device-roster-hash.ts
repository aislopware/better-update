import { Effect } from "effect";

import { CryptoService } from "./crypto-service";

import type { CryptoError } from "./crypto-service";

export const computeDeviceRosterHash = (
  ascDeviceIds: readonly string[],
): Effect.Effect<string, CryptoError, CryptoService> =>
  Effect.gen(function* () {
    const service = yield* CryptoService;
    const sorted = [...ascDeviceIds].toSorted();
    return yield* service.sha256Hex(sorted.join(","));
  });
