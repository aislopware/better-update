import type { Platform } from "./build-profile";
import type { ExpoConfig } from "./expo-config";

export type UpdatePlatformOption = Platform | "all";

export const resolveUpdatePlatforms = (
  config: ExpoConfig,
  requestedPlatform: UpdatePlatformOption,
): readonly Platform[] => {
  if (requestedPlatform !== "all") {
    return [requestedPlatform] as const;
  }

  return (["ios", "android"] as const).filter((platform) => config[platform] !== undefined);
};
