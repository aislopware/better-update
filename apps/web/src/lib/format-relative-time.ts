const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

export const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) {
    return "just now";
  }
  const min = Math.floor(sec / 60);
  if (min < 60) {
    return rtf.format(-min, "minute");
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return rtf.format(-hr, "hour");
  }
  const day = Math.floor(hr / 24);
  if (day < 30) {
    return rtf.format(-day, "day");
  }
  return new Date(iso).toLocaleDateString();
};

export const formatRelativeFuture = (iso: string): string => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {
    return "expired";
  }
  const min = Math.floor(diff / 60_000);
  if (min < 60) {
    return rtf.format(min, "minute");
  }
  const hr = Math.floor(min / 60);
  if (hr < 24) {
    return rtf.format(hr, "hour");
  }
  const day = Math.floor(hr / 24);
  return rtf.format(day, "day");
};
