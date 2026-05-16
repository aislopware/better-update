export const formatBytes = (bytes: number): string => {
  if (bytes === 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"] as const;
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** idx;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[idx]}`;
};
