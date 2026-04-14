import { buildCompatibilityMatrixQueryKey, buildsQueryKey } from "@better-update/api-client/react";
import { Effect } from "effect";

import type { ArtifactFormat, Distribution, Platform } from "@better-update/api";
import type { QueryClient } from "@tanstack/react-query";

export type ArtifactFormatValue = typeof ArtifactFormat.Type;
export type PlatformValue = typeof Platform.Type;
export type DistributionValue = typeof Distribution.Type;

export const DISTRIBUTIONS_BY_PLATFORM: Record<
  PlatformValue,
  readonly [DistributionValue, ...DistributionValue[]]
> = {
  ios: ["app-store", "ad-hoc", "development", "enterprise", "simulator"],
  android: ["play-store", "direct"],
};

export const FORMATS_BY_PLATFORM: Record<
  PlatformValue,
  readonly [ArtifactFormatValue, ...ArtifactFormatValue[]]
> = {
  ios: ["ipa", "tar.gz"],
  android: ["apk", "aab"],
};

export const DISTRIBUTION_LABELS: Record<DistributionValue, string> = {
  "app-store": "App Store",
  "ad-hoc": "Ad Hoc",
  development: "Development",
  enterprise: "Enterprise",
  simulator: "Simulator",
  "play-store": "Play Store",
  direct: "Direct",
};

export const FORMAT_LABELS: Record<ArtifactFormatValue, string> = {
  ipa: "IPA",
  apk: "APK",
  aab: "AAB",
  "tar.gz": "tar.gz",
};

export const detectArtifactFormat = (filename: string): ArtifactFormatValue | null => {
  if (filename.endsWith(".tar.gz")) {
    return "tar.gz";
  }
  if (filename.endsWith(".ipa")) {
    return "ipa";
  }
  if (filename.endsWith(".apk")) {
    return "apk";
  }
  if (filename.endsWith(".aab")) {
    return "aab";
  }
  return null;
};

export const detectPlatform = (format: ArtifactFormatValue): PlatformValue | null => {
  if (format === "ipa" || format === "tar.gz") {
    return "ios";
  }
  return "android";
};

export const defaultFormatForDistribution = (
  platform: PlatformValue,
  distribution: DistributionValue,
): ArtifactFormatValue => {
  if (platform === "ios") {
    return distribution === "simulator" ? "tar.gz" : "ipa";
  }

  return distribution === "play-store" ? "aab" : "apk";
};

export const defaultDistributionForFormat = (
  platform: PlatformValue,
  format: ArtifactFormatValue,
): DistributionValue => {
  if (platform === "ios") {
    return format === "tar.gz" ? "simulator" : "development";
  }

  return format === "aab" ? "play-store" : "direct";
};

export const isCompatibleBuildSelection = (
  platform: PlatformValue,
  distribution: DistributionValue,
  format: ArtifactFormatValue,
) => {
  if (platform === "ios") {
    return (
      (distribution === "simulator" && format === "tar.gz") ||
      (distribution !== "simulator" && format === "ipa")
    );
  }

  return (
    (distribution === "play-store" && format === "aab") ||
    (distribution === "direct" && format === "apk")
  );
};

export const computeSha256 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const uploadWithProgress = async (
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> =>
  Effect.runPromise(
    Effect.async<undefined, Error>((resume) => {
      const xhr = new XMLHttpRequest();
      const uploadState = { settled: false };

      const settle = (effect: Effect.Effect<undefined, Error>) => {
        if (uploadState.settled) {
          return;
        }
        uploadState.settled = true;
        signal?.removeEventListener("abort", onAbort);
        xhr.upload.removeEventListener("progress", onProgressEvent);
        xhr.removeEventListener("load", onLoad);
        xhr.removeEventListener("error", onError);
        resume(effect);
      };

      const onProgressEvent = (event: ProgressEvent<XMLHttpRequestEventTarget>) => {
        if (event.lengthComputable) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      };

      const onLoad = () => {
        settle(
          xhr.status >= 200 && xhr.status < 300
            ? Effect.succeed(undefined)
            : Effect.fail(new Error(`Upload failed with status ${xhr.status}`)),
        );
      };

      const onError = () => {
        settle(Effect.fail(new Error("Upload network error")));
      };

      const onAbort = () => {
        xhr.abort();
        settle(Effect.fail(new Error("Upload aborted")));
      };

      const cleanup = Effect.sync(() => {
        signal?.removeEventListener("abort", onAbort);
        xhr.upload.removeEventListener("progress", onProgressEvent);
        xhr.removeEventListener("load", onLoad);
        xhr.removeEventListener("error", onError);
        if (!uploadState.settled) {
          xhr.abort();
        }
      });

      if (signal?.aborted) {
        settle(Effect.fail(new Error("Upload aborted")));
        return cleanup;
      }

      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.addEventListener("progress", onProgressEvent);
      xhr.addEventListener("load", onLoad);
      xhr.addEventListener("error", onError);
      signal?.addEventListener("abort", onAbort, { once: true });
      xhr.send(file);

      return cleanup;
    }),
  );

export const invalidateBuildQueries = async (
  queryClient: QueryClient,
  orgId: string,
  projectId: string,
) =>
  Effect.runPromise(
    Effect.asVoid(
      Effect.all(
        [
          Effect.promise(async () =>
            queryClient.invalidateQueries({
              queryKey: buildsQueryKey(orgId, projectId),
            }),
          ),
          Effect.promise(async () =>
            queryClient.invalidateQueries({
              queryKey: buildCompatibilityMatrixQueryKey(orgId, projectId),
            }),
          ),
        ],
        { concurrency: "unbounded" },
      ),
    ),
  );

export const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"] as const;
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`;
};

export const PHASE_LABELS = {
  idle: "Upload",
  reserving: "Reserving...",
  uploading: "Uploading...",
  completing: "Finalizing...",
  done: "Complete",
} as const;

export type UploadPhase = keyof typeof PHASE_LABELS;

export const progressWidth = (phase: UploadPhase, progress: number): string => {
  if (phase === "uploading") {
    return `${progress}%`;
  }
  if (phase === "completing" || phase === "done") {
    return "100%";
  }
  return "0%";
};
