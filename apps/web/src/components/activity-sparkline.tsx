import { cn } from "@better-update/ui/lib/utils";

import type { ActivityPoint } from "./shipping-activity";

/**
 * One project's month, small enough to sit in a list row.
 *
 * Hand-drawn SVG rather than a chart component: a list page draws one of these
 * per row, and twenty ECharts instances to plot sixty bars between them is a
 * canvas, a resize observer and a tooltip layer each. The shape is the same one
 * the panel above draws — a bar per day, builds stacked on updates — so a row
 * and the summary beside it read as the same measurement.
 *
 * The baseline is always drawn. A project that shipped nothing this month is a
 * fact worth showing, and a slot that empties out entirely reads as a bug.
 */
const WIDTH = 104;
const HEIGHT = 26;
const GAP = 1;

const barGeometry = (count: number): { readonly width: number; readonly step: number } => {
  const step = WIDTH / Math.max(count, 1);
  return { width: Math.max(step - GAP, 1), step };
};

export const ActivitySparkline = ({
  series,
  colors,
  label,
  className,
}: {
  readonly series: readonly ActivityPoint[];
  /** The panel's own series colours, so the two agree on what blue means. */
  readonly colors: { readonly updates: string; readonly builds: string };
  readonly label: string;
  readonly className?: string;
}) => {
  const { width, step } = barGeometry(series.length);
  const peak = Math.max(1, ...series.map((point) => point.updates + point.builds));
  const scale = (value: number): number => (value / peak) * HEIGHT;

  return (
    <svg
      // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- an inline <svg> IS the graphic; `<img>` would need a separate file to point at
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT + 1}`}
      className={cn("h-7 w-26 shrink-0 overflow-visible", className)}
      preserveAspectRatio="none"
    >
      <line
        x1={0}
        y1={HEIGHT + 0.5}
        x2={WIDTH}
        y2={HEIGHT + 0.5}
        className="stroke-kumo-line"
        strokeWidth={1}
      />
      {series.map((point, index) => {
        const updates = scale(point.updates);
        const builds = scale(point.builds);
        const left = index * step;
        return (
          // Days are the x axis: the key is the date, and a day with nothing
          // shipped still holds its place so a quiet week reads as a gap.
          <g key={point.date}>
            <rect x={left} y={HEIGHT - builds} width={width} height={builds} fill={colors.builds} />
            <rect
              x={left}
              y={HEIGHT - builds - updates}
              width={width}
              height={updates}
              fill={colors.updates}
            />
          </g>
        );
      })}
    </svg>
  );
};
