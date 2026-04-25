import { asRecord } from "@better-update/type-guards";

import type { Platform } from "./build-profile";

export type UpdatePlatformOption = Platform | "all";

export const resolveUpdatePlatforms = (
  appJson: Record<string, unknown>,
  requestedPlatform: UpdatePlatformOption,
): readonly Platform[] => {
  if (requestedPlatform !== "all") {
    return [requestedPlatform] as const;
  }

  const expo = asRecord(appJson["expo"]);
  return (["ios", "android"] as const).filter(
    (platform) => asRecord(expo?.[platform]) !== undefined,
  );
};
