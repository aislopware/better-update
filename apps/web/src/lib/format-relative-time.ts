import { differenceInDays, differenceInSeconds, formatDistanceToNowStrict, isPast } from "date-fns";

import { asDate, formatShortDate } from "./format-date";

import type { DateInput } from "./format-date";

export const formatRelativeTime = (value: DateInput): string => {
  const date = asDate(value);
  if (differenceInSeconds(new Date(), date) < 60) {
    return "just now";
  }
  // Beyond a month, an absolute date reads better than "2 months ago".
  if (differenceInDays(new Date(), date) >= 30) {
    return formatShortDate(date);
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
};

export const formatRelativeFuture = (value: DateInput): string => {
  const date = asDate(value);
  if (isPast(date)) {
    return "expired";
  }
  return formatDistanceToNowStrict(date, { addSuffix: true });
};
