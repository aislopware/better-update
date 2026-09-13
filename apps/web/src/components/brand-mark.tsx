import { cn } from "@better-update/ui/lib/utils";

interface BrandIconProps {
  readonly size?: number;
  readonly className?: string;
}

/**
 * The aislopware family mark: nine dots, three by three, the lit ones drawing
 * this product's glyph. better-update lights an up arrow (`... / .#. / ###`);
 * the unlit dots stay at 0.3 opacity so the grid reads as one family with
 * aislopware (A) and slopscale (S). Same geometry as their marks: viewBox 100,
 * inset 20, pitch 30, r 11. Colour comes from `currentColor` — wrap it in
 * `text-brand` for the family lavender, or leave it mono on quiet surfaces.
 */
const GRID = [20, 50, 80] as const;
const ARROW = [
  [false, false, false],
  [false, true, false],
  [true, true, true],
] as const;
const DOTS = ARROW.flatMap((row, rowIndex) =>
  row.map((lit, colIndex) => ({ cx: GRID[colIndex], cy: GRID[rowIndex], lit })),
);

export const BrandIcon = ({ size = 40, className }: BrandIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
  >
    {DOTS.map(({ cx, cy, lit }) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={11} fillOpacity={lit ? 1 : 0.3} />
    ))}
  </svg>
);

/**
 * Quiet brand backdrop: the two radial-gradient blobs from the login hero,
 * shared by the first-impression surfaces (onboarding, pending approval,
 * invitation, CLI login) so the auth → onboarding journey reads as one place.
 * Parent must be `relative overflow-hidden`.
 */
export const BrandBackdrop = ({ className }: { readonly className?: string }) => (
  <div
    aria-hidden="true"
    className={cn("pointer-events-none absolute inset-0 select-none", className)}
  >
    <div className="absolute top-[18%] right-[-8%] size-[520px] rounded-full bg-[radial-gradient(circle,oklch(0.65_0.22_275/0.12)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.24_275/0.22)_0%,transparent_65%)]" />
    <div className="absolute bottom-[-12%] left-[-10%] size-[440px] rounded-full bg-[radial-gradient(circle,oklch(0.7_0.16_220/0.14)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.2_220/0.22)_0%,transparent_65%)]" />
  </div>
);

interface BrandWordmarkProps {
  readonly className?: string;
  readonly iconSize?: number;
}

export const BrandWordmark = ({ className, iconSize = 44 }: BrandWordmarkProps) => (
  <div className={cn("flex items-center gap-3", className)}>
    <BrandIcon size={iconSize} className="text-brand" />
    <div className="flex flex-col leading-none">
      <span className="font-heading text-kumo-default text-lg font-semibold tracking-tight">
        Better Update
      </span>
      <span className="text-kumo-subtle mt-1 text-[0.7rem] tracking-wide uppercase">
        Ship faster
      </span>
    </div>
  </div>
);
