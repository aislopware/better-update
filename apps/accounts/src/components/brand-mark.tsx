import { cn } from "@better-update/ui/lib/utils";

interface BrandIconProps {
  readonly size?: number;
  readonly className?: string;
}

export const BrandIcon = ({ size = 40, className }: BrandIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={className}
  >
    <rect x="10.5" y="10.5" width="19" height="19" rx="3.5" transform="rotate(45 20 20)" />
  </svg>
);

interface BrandWordmarkProps {
  readonly className?: string;
  readonly iconSize?: number;
}

export const BrandWordmark = ({ className, iconSize = 44 }: BrandWordmarkProps) => (
  <div className={cn("flex items-center gap-3", className)}>
    <BrandIcon size={iconSize} className="text-foreground" />
    <div className="flex flex-col leading-none">
      <span className="font-heading text-foreground text-lg font-semibold tracking-tight">
        Better Update
      </span>
      <span className="text-muted-foreground mt-1 text-[0.7rem] tracking-wide uppercase">
        Ship faster
      </span>
    </div>
  </div>
);
