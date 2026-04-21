import { asRecord } from "./record";

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
  const platforms: Platform[] = [];
  if (asRecord(expo?.["ios"])) {
    platforms.push("ios");
  }
  if (asRecord(expo?.["android"])) {
    platforms.push("android");
  }
  return platforms;
};
