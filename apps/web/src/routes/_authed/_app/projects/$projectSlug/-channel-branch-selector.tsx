import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@better-update/ui/components/ui/tooltip";
import { GitBranchIcon } from "lucide-react";

import type { BranchItem } from "@better-update/api-client/react";

interface ChannelBranchSelectorProps {
  readonly branches: readonly BranchItem[];
  readonly branchLabels: Record<string, string>;
  readonly currentBranchId: string;
  readonly currentBranchName: string;
  readonly isRollingOut: boolean;
  readonly onRelink: (branchId: string) => void;
}

export const ChannelBranchSelector = ({
  branches,
  branchLabels,
  currentBranchId,
  currentBranchName,
  isRollingOut,
  onRelink,
}: ChannelBranchSelectorProps) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <div className="flex items-center gap-2">
          <GitBranchIcon strokeWidth={2} className="text-muted-foreground size-4" />
          <Select
            items={branchLabels}
            value={currentBranchId}
            disabled={isRollingOut}
            onValueChange={(value) => {
              if (value) {
                onRelink(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue>{currentBranchName}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {branches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
      }
    />
    <TooltipPopup>
      {isRollingOut
        ? "Cannot change branch while a rollout is active. Complete or revert the rollout first."
        : "Switch the branch this channel serves"}
    </TooltipPopup>
  </Tooltip>
);
