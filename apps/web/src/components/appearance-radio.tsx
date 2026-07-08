import { RadioGroup, RadioGroupItem } from "@better-update/ui/components/ui/radio-group";
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
  <RadioGroup
    value={value}
    onValueChange={(next: T) => {
      onValueChange(next);
    }}
    name={name}
    className={cn("grid gap-3 sm:grid-cols-3", className)}
  >
    {options.map((opt) => (
      <label
        key={opt.value}
        className={cn(
          "bg-card relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border p-2 transition-all",
          "hover:border-foreground/24",
          "has-data-checked:border-foreground has-data-checked:ring-foreground/12 has-data-checked:ring-2",
        )}
      >
        <div className="bg-muted/50 aspect-[16/10] overflow-hidden rounded-lg border">
          {opt.preview}
        </div>
        <div className="flex items-center gap-2 px-1 py-1">
          <RadioGroupItem value={opt.value} />
          <span className="text-sm leading-none font-medium">{opt.label}</span>
        </div>
      </label>
    ))}
  </RadioGroup>
);
