import { DataTableFacetedFilter } from "../../../../../../lib/data-table";

interface BranchOption {
  readonly id: string;
  readonly name: string;
}

const PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
] as const;

const isPlatform = (value: string): value is "ios" | "android" =>
  value === "ios" || value === "android";

export const UpdatesFilterBar = ({
  branches,
  branchFilter,
  platformFilter,
  onBranchFilter,
  onPlatformFilter,
}: {
  branches: readonly BranchOption[];
  branchFilter: readonly string[];
  platformFilter: readonly ("ios" | "android")[];
  onBranchFilter: (value: readonly string[]) => void;
  onPlatformFilter: (value: readonly ("ios" | "android")[]) => void;
}) => (
  <>
    <DataTableFacetedFilter
      title="Platform"
      options={PLATFORM_OPTIONS}
      selected={platformFilter}
      onChange={(next) => {
        onPlatformFilter(next.filter(isPlatform));
      }}
    />
    <DataTableFacetedFilter
      title="Branch"
      options={branches.map((branch) => ({ label: branch.name, value: branch.id }))}
      selected={branchFilter}
      onChange={onBranchFilter}
    />
  </>
);
