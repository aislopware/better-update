import { Button } from "@better-update/ui/components/ui/button";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";

export interface DataTablePaginationProps {
  readonly countLabel: string;
  /** When rows are selectable, shown instead of countLabel while a selection exists. */
  readonly selectedCount?: number;
  readonly safePage: number;
  readonly totalPages: number;
  readonly isPlaceholderData: boolean;
  readonly onChange: (next: number) => void;
}

const PageButton = ({
  label,
  disabled,
  hiddenOnMobile = false,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  hiddenOnMobile?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <Button
    variant="outline"
    size="icon-xs"
    className={hiddenOnMobile ? "hidden lg:inline-flex" : undefined}
    disabled={disabled}
    onClick={onClick}
    aria-label={label}
  >
    {children}
  </Button>
);

/**
 * Pagination row rendered below the table (shadcn data-table pattern): count /
 * selection summary on the left; page indicator + first/prev/next/last on the right.
 */
export const DataTablePagination = ({
  countLabel,
  selectedCount = 0,
  safePage,
  totalPages,
  isPlaceholderData,
  onChange,
}: DataTablePaginationProps) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground text-xs tabular-nums">
      {selectedCount > 0 ? `${selectedCount} selected` : countLabel}
    </span>
    <div className="flex items-center gap-4">
      <span className="text-muted-foreground hidden text-xs font-normal tabular-nums sm:inline">
        Page {safePage} of {totalPages}
      </span>
      <div className="flex items-center gap-1">
        <PageButton
          label="First page"
          hiddenOnMobile
          disabled={safePage === 1 || isPlaceholderData}
          onClick={() => {
            onChange(1);
          }}
        >
          <ChevronsLeftIcon strokeWidth={2} />
        </PageButton>
        <PageButton
          label="Previous page"
          disabled={safePage === 1 || isPlaceholderData}
          onClick={() => {
            onChange(safePage - 1);
          }}
        >
          <ChevronLeftIcon strokeWidth={2} />
        </PageButton>
        <PageButton
          label="Next page"
          disabled={safePage >= totalPages || isPlaceholderData}
          onClick={() => {
            onChange(safePage + 1);
          }}
        >
          <ChevronRightIcon strokeWidth={2} />
        </PageButton>
        <PageButton
          label="Last page"
          hiddenOnMobile
          disabled={safePage >= totalPages || isPlaceholderData}
          onClick={() => {
            onChange(totalPages);
          }}
        >
          <ChevronsRightIcon strokeWidth={2} />
        </PageButton>
      </div>
    </div>
  </div>
);
