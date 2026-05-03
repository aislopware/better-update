import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@better-update/ui/lib/utils";

import type { ComponentProps, ReactNode } from "react";

interface SlugInputProps extends ComponentProps<typeof InputPrimitive> {
  readonly addonStart: ReactNode;
}

export const SlugInput = ({ addonStart, className, ...props }: SlugInputProps) => (
  <span
    className={cn(
      "border-input bg-background ring-ring/24 text-foreground relative inline-flex h-8.5 w-full min-w-0 items-stretch overflow-hidden rounded-lg border text-base shadow-xs/5 transition-shadow not-dark:bg-clip-padding sm:h-7.5 sm:text-sm",
      "focus-within:border-ring focus-within:ring-[3px]",
      "has-aria-invalid:border-destructive/36 has-aria-invalid:focus-within:border-destructive/64 has-aria-invalid:focus-within:ring-destructive/16",
      "dark:bg-input/32",
      className,
    )}
    data-slot="slug-input"
  >
    <span className="text-muted-foreground/72 border-input bg-muted/40 pointer-events-none flex shrink-0 items-center border-r pr-2.5 pl-3">
      {addonStart}
    </span>
    <InputPrimitive
      className="placeholder:text-muted-foreground/72 h-full min-w-0 flex-1 bg-transparent px-3 leading-[inherit] outline-none"
      // eslint-disable-next-line react/jsx-props-no-spreading -- thin pass-through wrapper
      {...props}
    />
  </span>
);
