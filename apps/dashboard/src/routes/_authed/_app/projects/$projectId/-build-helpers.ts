export type ArtifactFormat = "ipa" | "apk" | "aab" | "tar.gz";
export type PlatformValue = "ios" | "android";
export type DistributionValue =
  | "app-store"
  | "ad-hoc"
  | "development"
  | "enterprise"
  | "simulator"
  | "play-store"
  | "direct";

export const detectArtifactFormat = (filename: string): ArtifactFormat | null => {
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

export const detectPlatform = (format: ArtifactFormat): PlatformValue | null => {
  if (format === "ipa") {
    return "ios";
  }
  if (format === "apk" || format === "aab") {
    return "android";
  }
  return null;
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
): Promise<void> =>
  // eslint-disable-next-line promise/avoid-new -- XHR upload progress requires manual Promise wrapping
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    });
    xhr.addEventListener("error", () => {
      reject(new Error("Upload network error"));
    });
    xhr.send(file);
  });

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
