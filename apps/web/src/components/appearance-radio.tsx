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
    orientation="horizontal"
    name={name}
    value={value}
    onValueChange={(next: T) => {
      onValueChange(next);
    }}
    // The card look is set per item, not on the group: a card group joins its
    // items into one panel split by dividers that assume two columns, and its
    // selected item is only tinted. Separate cards keep their own border and
    // the stronger selected edge. The group then lays them out itself — two-up,
    // widening to the option count once there is room, since these previews are
    // equal siblings that read as one row. The selector reaches past the
    // fieldset to the row Kumo renders inside it.
    className={cn(
      "[&>div]:grid [&>div]:grid-cols-2 [&>div]:gap-3 sm:[&>div]:grid-cols-3",
      className,
    )}
  >
    {options.map((option) => (
      <Radio.Item
        key={option.value}
        appearance="card"
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
