import { Button } from "@better-update/ui/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

export interface PaginationControlsProps {
  readonly countLabel: string;
  readonly safePage: number;
  readonly totalPages: number;
  readonly isPlaceholderData: boolean;
  readonly onChange: (next: number) => void;
}

export const PaginationControls = ({
  countLabel,
  safePage,
  totalPages,
  isPlaceholderData,
  onChange,
}: PaginationControlsProps) => (
  <div className="flex items-center justify-between gap-2">
    <span className="text-muted-foreground text-xs tabular-nums">{countLabel}</span>
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage === 1 || isPlaceholderData}
        onClick={() => {
          onChange(safePage - 1);
        }}
        aria-label="Previous page"
      >
        <ChevronLeftIcon strokeWidth={2} />
      </Button>
      <Button
        variant="outline"
        size="icon-xs"
        disabled={safePage >= totalPages || isPlaceholderData}
        onClick={() => {
          onChange(safePage + 1);
        }}
        aria-label="Next page"
      >
        <ChevronRightIcon strokeWidth={2} />
      </Button>
    </div>
  </div>
);
