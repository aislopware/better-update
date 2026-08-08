import { Button } from "@better-update/ui/components/button";
import { DropdownMenu } from "@better-update/ui/components/dropdown";
import { ArrowsDownUpIcon, CheckIcon } from "@phosphor-icons/react";

export interface ListSortOption {
  /** The API sort token, `-` prefixed for descending — the URL value verbatim. */
  readonly value: string;
  readonly label: string;
}

export interface ListSortMenuProps {
  readonly options: readonly ListSortOption[];
  readonly value: string;
  readonly onChange: (next: string) => void;
}

/**
 * Sorting for a list with no column headers to click. A card carries its fields
 * in a layout rather than in columns, so the order has to be named somewhere.
 *
 * It sits opposite the filters rather than inside them: filters decide which
 * rows exist, sorting only decides which comes first, and a control that never
 * hides anything should not be inside the card that does.
 */
export const ListSortMenu = ({ options, value, onChange }: ListSortMenuProps) => {
  const active = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger render={<Button variant="secondary" />}>
        <ArrowsDownUpIcon weight="bold" />
        <span className="text-kumo-subtle">Sort</span>
        {active?.label}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" className="w-52">
        {options.map((option) => (
          <DropdownMenu.Item
            key={option.value}
            onClick={() => {
              onChange(option.value);
            }}
          >
            {/* The tick keeps its space when absent, so the labels stay in one
                column rather than shifting as the selection moves. */}
            <CheckIcon
              weight="bold"
              className={option.value === value ? "size-4" : "invisible size-4"}
            />
            {option.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
};
