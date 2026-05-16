export const formatShortDate = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const formatWeekdayShort = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

export const formatTimeShort = (value: string): string =>
  new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export const formatDateTime = (value: string): string => new Date(value).toLocaleString();

export const formatDate = (value: string): string => new Date(value).toLocaleDateString();

export const formatChartTimestamp = (value: string): string => {
  const date = new Date(value);
  const datePart = date.toLocaleDateString(undefined, {
    month: "2-digit",
    day: "2-digit",
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${datePart} ${timePart}`;
};
