import type { BuildAudience, BuildPlatformValue } from "@better-update/api-client/react";

import { DISTRIBUTION_LABELS } from "../-build-helpers";
import { DataTableFacetedFilter } from "../../../../../../lib/data-table";

const PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
  { label: "macOS", value: "macos" },
  { label: "Windows", value: "windows" },
  { label: "Linux", value: "linux" },
] as const;

const AUDIENCE_OPTIONS = [
  { label: "Internal", value: "internal" },
  { label: "Store", value: "store" },
] as const;

const DISTRIBUTION_OPTIONS = Object.entries(DISTRIBUTION_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const isAudience = (value: string): value is BuildAudience =>
  value === "internal" || value === "store";

const isPlatform = (value: string): value is BuildPlatformValue =>
  PLATFORM_OPTIONS.some((option) => option.value === value);

export const BuildsFilterBar = ({
  platformFilter,
  distributionFilter,
  audienceFilter,
  onPlatformFilter,
  onDistributionFilter,
  onAudienceFilter,
}: {
  platformFilter: readonly BuildPlatformValue[];
  distributionFilter: readonly string[];
  audienceFilter: readonly BuildAudience[];
  onPlatformFilter: (value: readonly BuildPlatformValue[]) => void;
  onDistributionFilter: (value: readonly string[]) => void;
  onAudienceFilter: (value: readonly BuildAudience[]) => void;
}) => (
  <>
    <DataTableFacetedFilter
      title="Audience"
      options={AUDIENCE_OPTIONS}
      selected={audienceFilter}
      onChange={(next) => {
        onAudienceFilter(next.filter(isAudience));
      }}
    />
    <DataTableFacetedFilter
      title="Platform"
      options={PLATFORM_OPTIONS}
      selected={platformFilter}
      onChange={(next) => {
        onPlatformFilter(next.filter(isPlatform));
      }}
    />
    <DataTableFacetedFilter
      title="Distribution"
      options={DISTRIBUTION_OPTIONS}
      selected={distributionFilter}
      onChange={onDistributionFilter}
    />
  </>
);
