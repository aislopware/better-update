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

/** Axis ticks over a multi-day window, where the day is what separates them. */
export const formatChartDate = (value: DateInput): string => format(asDate(value), "MMM d");

/**
 * Axis ticks over a multi-day window in a narrow chart. ECharts adds its own
 * month-boundary ticks on top of the requested ones, which collide with the
 * neighbours at rail width — numerals are short enough to survive that.
 */
export const formatChartDateNarrow = (value: DateInput): string => format(asDate(value), "M/d");

/** Axis ticks within a day — 24-hour, so every tick is the same width. */
export const formatChartTime = (value: DateInput): string => format(asDate(value), "HH:mm");
