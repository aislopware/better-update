import { CircleCheckIcon, GitBranchIcon } from "lucide-react";

interface RolloutSplitDiagramProps {
  readonly oldBranchName: string;
  readonly newBranchName: string;
  readonly newBranchPercentage: number;
}

const clampPercentage = (value: number): number => {
  if (Number.isNaN(value) || value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return Math.round(value);
};

export const RolloutSplitDiagram = ({
  oldBranchName,
  newBranchName,
  newBranchPercentage,
}: RolloutSplitDiagramProps) => {
  const newPercent = clampPercentage(newBranchPercentage);
  const oldPercent = 100 - newPercent;

  return (
    <div
      className="flex flex-col gap-2"
      aria-label={`Rollout split: ${oldPercent}% on ${oldBranchName}, ${newPercent}% on ${newBranchName}`}
    >
      <div className="bg-muted relative h-7 overflow-hidden rounded-lg" aria-hidden="true">
        {oldPercent > 0 ? (
          <div
            className="bg-muted-foreground/70 absolute inset-y-0 left-0 transition-[width] duration-300"
            style={{ width: `${oldPercent}%` }}
          />
        ) : null}
        {newPercent > 0 ? (
          <div
            className="bg-primary absolute inset-y-0 right-0 transition-[width] duration-300"
            style={{ width: `${newPercent}%` }}
          />
        ) : null}
        {oldPercent > 0 && newPercent > 0 ? (
          <div
            className="bg-card absolute inset-y-0 w-px transition-[left] duration-300"
            style={{ left: `${oldPercent}%` }}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground flex items-center gap-1.5">
          <span className="bg-muted-foreground/70 size-2 rounded-full" aria-hidden="true" />
          <GitBranchIcon strokeWidth={2} className="size-3" />
          <span className="font-medium">{oldBranchName}</span>
          <span className="tabular-nums">{oldPercent}%</span>
        </div>
        <div className="text-foreground flex items-center gap-1.5">
          <span className="bg-primary size-2 rounded-full" aria-hidden="true" />
          <GitBranchIcon strokeWidth={2} className="size-3" />
          <span className="font-medium">{newBranchName}</span>
          <span className="tabular-nums">{newPercent}%</span>
          {newPercent === 100 ? (
            <CircleCheckIcon
              strokeWidth={2}
              className="text-success size-3.5"
              aria-label="Rollout at 100%"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};
