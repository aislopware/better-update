export const formatRelativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) {
    return "just now";
  }
  if (min < 60) {
    return `${min}m ago`;
  }
  if (hr < 24) {
    return `${hr}h ago`;
  }
  if (day < 30) {
    return `${day}d ago`;
  }
  return new Date(iso).toLocaleDateString();
};

export const formatRelativeFuture = (iso: string): string => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) {
    return "expired";
  }
  const min = Math.floor(diff / 60_000);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (min < 60) {
    return `in ${min}m`;
  }
  if (hr < 24) {
    return `in ${hr}h`;
  }
  return `in ${day}d`;
};
