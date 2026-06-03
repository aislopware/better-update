import type { BuildProfile } from "./build-profile";
import type { ProjectType } from "./detect-project-type";

/**
 * How a platform's artifact is produced:
 * - `expo`   — `expo prebuild` then gradle/xcodebuild (managed flow)
 * - `gradle` — run gradle against the committed `android/` (bare/kmp/native)
 * - `xcode`  — run xcodebuild against the committed `ios/` (bare/kmp/native)
 * - `custom` — run a user-supplied build command (escape hatch)
 */
export type AndroidBuildStrategy = "expo" | "gradle" | "custom";
export type IosBuildStrategy = "expo" | "xcode" | "custom";

export const resolveAndroidStrategy = (
  profile: BuildProfile,
  projectType: ProjectType,
): AndroidBuildStrategy => {
  if (profile.customCommand?.android !== undefined) {
    return "custom";
  }
  return projectType === "expo" ? "expo" : "gradle";
};

export const resolveIosStrategy = (
  profile: BuildProfile,
  projectType: ProjectType,
): IosBuildStrategy => {
  if (profile.customCommand?.ios !== undefined) {
    return "custom";
  }
  return projectType === "expo" ? "expo" : "xcode";
};
