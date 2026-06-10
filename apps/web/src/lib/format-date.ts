import { format, parseISO } from "date-fns";

export type DateInput = string | Date;

export const asDate = (value: DateInput): Date =>
  typeof value === "string" ? parseISO(value) : value;

export const formatShortDate = (value: DateInput): string => format(asDate(value), "MMM d, yyyy");

export const formatWeekdayShort = (value: DateInput): string => format(asDate(value), "EEE, MMM d");

export const formatTimeShort = (value: DateInput): string => format(asDate(value), "h:mm a");

export const formatShortDateTime = (value: DateInput): string =>
  format(asDate(value), "MMM d, yyyy, h:mm a");

export const formatDateTime = (value: DateInput): string =>
  format(asDate(value), "MMM d, yyyy, h:mm:ss a");

export const formatChartTimestamp = (value: DateInput): string =>
  format(asDate(value), "MM/dd HH:mm");
