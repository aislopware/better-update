import { cn } from "@better-update/ui/lib/utils";

import type { ReactNode } from "react";

interface AppearanceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly preview: ReactNode;
}

interface AppearanceRadioGroupProps<T extends string> {
  readonly value: T;
  readonly onValueChange: (value: T) => void;
  readonly options: readonly AppearanceOption<T>[];
  readonly name: string;
  readonly className?: string;
}

export const AppearanceRadioGroup = <T extends string>({
  value,
  onValueChange,
  options,
  name,
  className,
}: AppearanceRadioGroupProps<T>) => (
  <div className={cn("grid gap-3 sm:grid-cols-3", className)}>
    {options.map((opt) => {
      const isSelected = value === opt.value;
      return (
        <label
          key={opt.value}
          className={cn(
            "group/appearance-card bg-card relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border p-2 transition-all",
            "hover:border-foreground/24",
            isSelected && "border-foreground ring-foreground/12 ring-2",
          )}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={isSelected}
            onChange={() => {
              onValueChange(opt.value);
            }}
            className="sr-only"
          />
          <div className="bg-muted/50 aspect-[16/10] overflow-hidden rounded-lg border">
            {opt.preview}
          </div>
          <div className="flex items-center gap-2 px-1 py-1">
            <span
              className={cn(
                "size-4 rounded-full border-2 transition-colors",
                isSelected ? "border-foreground bg-foreground" : "border-muted-foreground/40",
              )}
              aria-hidden="true"
            >
              {isSelected ? (
                <span className="bg-background m-0.5 block size-2 rounded-full" />
              ) : null}
            </span>
            <span className="text-sm leading-none font-medium">{opt.label}</span>
          </div>
        </label>
      );
    })}
  </div>
);
