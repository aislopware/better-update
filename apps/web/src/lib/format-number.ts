export const numberFormatter = new Intl.NumberFormat();

/** Ratios read as whole percents — "62%", not "61.8%". */
export const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 0,
});

/** Axis ticks stay legible at four digits; the tooltip carries the exact count. */
export const compactNumber = (value: number): string => {
  if (value < 1000) {
    return `${value}`;
  }
  const thousands = value / 1000;
  // A whole number of thousands reads better without the ".0" — "5k", not "5.0k".
  return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
};
