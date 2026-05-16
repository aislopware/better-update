import { RadioGroupPrimitive, RadioPrimitive } from "@better-update/ui/components/ui/radio-group";
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
  <RadioGroupPrimitive
    value={value}
    onValueChange={(next) => {
      onValueChange(next);
    }}
    name={name}
    className={cn("grid gap-3 sm:grid-cols-3", className)}
  >
    {options.map((opt) => (
      <RadioPrimitive.Root
        key={opt.value}
        value={opt.value}
        render={
          // eslint-disable-next-line jsx-a11y/label-has-associated-control -- Base UI Radio.Root renders the input as a child of this label via render-prop; label-input association is implicit through Base UI internals
          <label
            className={cn(
              "group/appearance-card bg-card relative flex cursor-pointer flex-col gap-2 overflow-hidden rounded-xl border p-2 transition-all",
              "hover:border-foreground/24",
              "data-checked:border-foreground data-checked:ring-foreground/12 data-checked:ring-2",
            )}
          />
        }
      >
        <div className="bg-muted/50 aspect-[16/10] overflow-hidden rounded-lg border">
          {opt.preview}
        </div>
        <div className="flex items-center gap-2 px-1 py-1">
          <span
            className={cn(
              "size-4 rounded-full border-2 transition-colors",
              "group-data-unchecked/appearance-card:border-muted-foreground/40",
              "group-data-checked/appearance-card:border-foreground group-data-checked/appearance-card:bg-foreground",
            )}
            aria-hidden="true"
          >
            <span className="bg-background m-0.5 hidden size-2 rounded-full group-data-checked/appearance-card:block" />
          </span>
          <span className="text-sm leading-none font-medium">{opt.label}</span>
        </div>
      </RadioPrimitive.Root>
    ))}
  </RadioGroupPrimitive>
);
