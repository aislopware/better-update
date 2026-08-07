import { Radio } from "@better-update/ui/components/radio";
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

/**
 * Choice cards that are picked by their picture rather than their name — the
 * theme switcher being the only one so far. Kumo's card radio already draws the
 * frame, the selected state and the control, so the preview rides along inside
 * the item's label above its caption.
 */
export const AppearanceRadioGroup = <T extends string>({
  value,
  onValueChange,
  options,
  name,
  className,
}: AppearanceRadioGroupProps<T>) => (
  <Radio.Group
    appearance="card"
    orientation="horizontal"
    name={name}
    value={value}
    onValueChange={(next: T) => {
      onValueChange(next);
    }}
    // Kumo lays horizontal choice cards out two-up. These previews are equal
    // siblings that read as one row, so the item grid widens to the option
    // count once there is room; the selector reaches past the fieldset to the
    // row Kumo renders inside it.
    className={cn("sm:[&>div]:grid-cols-3", className)}
  >
    {options.map((option) => (
      <Radio.Item
        key={option.value}
        value={option.value}
        label={
          <>
            <span className="bg-kumo-recessed ring-kumo-hairline mb-2 block aspect-[16/10] overflow-hidden rounded-lg ring-1">
              {option.preview}
            </span>
            {option.label}
          </>
        }
      />
    ))}
  </Radio.Group>
);
