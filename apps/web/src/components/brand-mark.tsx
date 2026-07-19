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
