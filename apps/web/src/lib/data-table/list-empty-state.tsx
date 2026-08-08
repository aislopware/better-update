import { Button } from "@better-update/ui/components/button";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

export interface FilteredEmptyProps {
  /** Plural entity noun — copy renders as "No <entity> match your filters." */
  readonly entity: string;
  /** True while any filter/search is active (mirror the toolbar's isFiltered). */
  readonly isFiltered: boolean;
  /** Wire to the same reset handler as the toolbar's onReset. */
  readonly onClear: () => void;
}

/**
 * Zero results *because of the filters* — a passive note with a way back, not
 * the page's empty state. Shared by the table and the card list so a filtered
 * table and a filtered card list say the same thing in the same shape.
 */
export const FilteredEmptyState = ({ entity, onClear }: Omit<FilteredEmptyProps, "isFiltered">) => (
  <div className="flex flex-col items-center gap-2 py-8 text-center">
    <MagnifyingGlassIcon className="text-kumo-subtle/72 size-5" aria-hidden />
    <p className="text-kumo-subtle text-sm">No {entity} match your filters.</p>
    <Button variant="secondary" size="sm" onClick={onClear}>
      Clear filters
    </Button>
  </div>
);
