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

  // Typeof null === "object" in JS, so an explicit null check is required to
  // Reject configs that opt a platform out via `ios: null` / `android: null`.
  return (["ios", "android"] as const).filter(
    (platform) =>
      // eslint-disable-next-line typescript/no-unnecessary-condition -- runtime guards against `ios: null` / `android: null` even though the static type excludes null
      typeof config[platform] === "object" && config[platform] !== null,
  );
};
