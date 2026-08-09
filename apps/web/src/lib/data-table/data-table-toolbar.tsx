import { InputGroup } from "@better-update/ui/components/input-group";
import { Toolbar } from "@better-update/ui/components/toolbar";
import { cn } from "@better-update/ui/lib/utils";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

import type { ReactNode } from "react";

/**
 * Draws the toolbar's internal dividers and outer corners from the items alone,
 * ignoring Base UI's focus guards.
 *
 * Kumo has each toolbar item place its own edges — `first:rounded-l-lg`,
 * `last:rounded-r-lg`, `not-first:border-l`. Opening a popover whose trigger is
 * one of those items breaks all three: Base UI brackets the trigger with a pair
 * of `[data-base-ui-focus-guard]` spans and an `[aria-owns]` span, which are
 * off-screen and weightless but are still element siblings. The first filter
 * stops being `:first-child`, so it squares off its left corners and grows a
 * divider against the card's own edge — a stray vertical rule with a sliver of
 * empty card to its left, appearing only while the menu is open.
 *
 * These re-derive the same three edges over "children that are not guards": the
 * dividers land between real items, and the outer corners on the real first and
 * last. Written out in full because Tailwind reads class names as literals.
 */
const ITEM_EDGES = [
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])]:rounded-l-lg",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])]:rounded-r-none",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])]:border-l-0",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])_~_:not([data-base-ui-focus-guard]):not([aria-owns])]:rounded-l-none",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])_~_:not([data-base-ui-focus-guard]):not([aria-owns])]:border-l",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns])_~_:not([data-base-ui-focus-guard]):not([aria-owns])]:border-kumo-line",
  "[&>:not([data-base-ui-focus-guard]):not([aria-owns]):not(:has(~_:not([data-base-ui-focus-guard]):not([aria-owns])))]:rounded-r-lg",
].join(" ");

export interface DataTableToolbarProps {
  /** Debounced search input (wire value/onChange through useDebouncedSearch). */
  readonly search?: {
    readonly value: string;
    readonly onChange: (next: string) => void;
    readonly placeholder: string;
  };
  /** Filter chips (DataTableFacetedFilter and friends) — all toolbar items. */
  readonly children?: ReactNode;
  /** True when any filter/search is active — shows the Reset button. */
  readonly isFiltered?: boolean;
  readonly onReset?: () => void;
  /** Right-aligned slot (view options, primary actions) — outside the card. */
  readonly actions?: ReactNode;
}

/**
 * Row above a data table. Everything that narrows the list — search, filter
 * chips, reset — sits inside one Kumo `Toolbar`, which draws them as a single
 * card with shared sizing and internal separators rather than a scatter of
 * loose controls. Actions stay outside it: a primary button is not a filter,
 * and the ghost styling the toolbar imposes would hide that.
 */
export const DataTableToolbar = ({
  search,
  children,
  isFiltered = false,
  onReset,
  actions,
}: DataTableToolbarProps) => {
  const handleReset = (): void => {
    onReset?.();
  };
  const hasFilters = search !== undefined || children !== undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The toolbar keeps Kumo's default size rather than `sm`, which draws at
          12px: a filter row set smaller than the table it filters reads as a
          footnote to it. */}
      {hasFilters ? (
        // A segmented strip cannot wrap — its items draw the seams between them
        // — so where the row runs out of width it scrolls instead of squeezing.
        // On a phone the flex row was taking it out of the search field, which
        // shrank to a sliver of its own magnifier while the filters kept their
        // labels.
        //
        // The padding is what the scroll costs: a scroll container clips on all
        // four sides, and the toolbar's outline is a `ring` — a shadow drawn
        // outside its box, not a border inside it. Without room to sit in, the
        // strip lost its left and right caps and a focused item lost its ring.
        // The negative margin hands that room back so the strip still lines up
        // with the table under it.
        <div className="-m-1 max-w-full overflow-x-auto p-1">
          <Toolbar className={cn("w-max", ITEM_EDGES)}>
            {search ? (
              <Toolbar.InputGroup aria-label={search.placeholder} className="w-48 sm:w-64">
                <InputGroup.Input
                  type="search"
                  value={search.value}
                  placeholder={search.placeholder}
                  onChange={(event) => {
                    search.onChange(event.target.value);
                  }}
                />
                <InputGroup.Addon>
                  <MagnifyingGlassIcon />
                </InputGroup.Addon>
              </Toolbar.InputGroup>
            ) : null}
            {children}
            {isFiltered && onReset ? (
              <Toolbar.Button icon={XIcon} onClick={handleReset}>
                Reset
              </Toolbar.Button>
            ) : null}
          </Toolbar>
        </div>
      ) : null}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </div>
  );
};
