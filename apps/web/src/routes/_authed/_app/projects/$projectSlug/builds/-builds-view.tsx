import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";

import { DISTRIBUTION_LABELS } from "../-build-helpers";

const PLATFORM_FILTER_LABELS: Record<string, string> = {
  all: "All platforms",
  ios: "iOS",
  android: "Android",
};

const DISTRIBUTION_FILTER_LABELS: Record<string, string> = {
  all: "All distributions",
  ...DISTRIBUTION_LABELS,
};

export const BuildsFilterBar = ({
  platformFilter,
  distributionFilter,
  onPlatformFilter,
  onDistributionFilter,
}: {
  platformFilter: "ios" | "android" | undefined;
  distributionFilter: string | undefined;
  onPlatformFilter: (value: "ios" | "android" | undefined) => void;
  onDistributionFilter: (value: string | undefined) => void;
}) => (
  <>
    <Select
      items={PLATFORM_FILTER_LABELS}
      value={platformFilter ?? "all"}
      onValueChange={(value) => {
        if (value === "ios" || value === "android") {
          onPlatformFilter(value);
        } else {
          onPlatformFilter(undefined);
        }
      }}
    >
      <SelectTrigger className="w-36">
        <SelectValue placeholder="All platforms" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All platforms</SelectItem>
          <SelectItem value="ios">iOS</SelectItem>
          <SelectItem value="android">Android</SelectItem>
        </SelectGroup>
      </SelectPopup>
    </Select>
    <Select
      items={DISTRIBUTION_FILTER_LABELS}
      value={distributionFilter ?? "all"}
      onValueChange={(value) => {
        if (value === "all" || value === null) {
          onDistributionFilter(undefined);
          return;
        }
        onDistributionFilter(value);
      }}
    >
      <SelectTrigger className="w-44">
        <SelectValue placeholder="All distributions" />
      </SelectTrigger>
      <SelectPopup>
        <SelectGroup>
          <SelectItem value="all">All distributions</SelectItem>
          {Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectPopup>
    </Select>
  </>
);
