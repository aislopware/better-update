import { Button } from "@better-update/ui/components/button";
import { InputGroup } from "@better-update/ui/components/input-group";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

import type { ReactNode } from "react";

export interface DataTableToolbarProps {
  /** Debounced search input (wire value/onChange through useDebouncedSearch). */
  readonly search?: {
    readonly value: string;
    readonly onChange: (next: string) => void;
    readonly placeholder: string;
  };
  /** Filter chips (DataTableFacetedFilter and friends). */
  readonly children?: ReactNode;
  /** True when any filter/search is active — shows the Reset button. */
  readonly isFiltered?: boolean;
  readonly onReset?: () => void;
  /** Right-aligned slot (view options, primary actions). */
  readonly actions?: ReactNode;
}

/**
 * Toolbar row above a data table (shadcn data-table pattern):
 * search + faceted filter chips + reset on the left, actions on the right.
 */
export const DataTableToolbar = ({
  search,
  children,
  isFiltered = false,
  onReset,
  actions,
}: DataTableToolbarProps) => (
  <div className="flex flex-wrap items-center gap-2">
    {search ? (
      <InputGroup className="w-full sm:w-56">
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
      </InputGroup>
    ) : null}
    {children}
    {isFiltered && onReset ? (
      <Button
        variant="ghost"
        onClick={() => {
          onReset();
        }}
      >
        Reset
        <XIcon weight="bold" />
      </Button>
    ) : null}
    {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
  </div>
);
