import { branchesQueryOptions } from "@better-update/api-client/react";
import { useState } from "react";

import { useServerSearchList } from "../../../../../../components/server-search-combobox";
import { DataTableFacetedFilter } from "../../../../../../lib/data-table";
import { DROPDOWN_FETCH_LIMIT } from "../../../../../../queries/constants";

const PLATFORM_OPTIONS = [
  { label: "iOS", value: "ios" },
  { label: "Android", value: "android" },
] as const;

const isPlatform = (value: string): value is "ios" | "android" =>
  value === "ios" || value === "android";

/**
 * Server-searched branch facet: options come from the current (searched) page,
 * while a pick-time label cache keeps selected branches' name badges intact
 * when the page changes. Selected ids never seen in any page (deep links)
 * fall back to a truncated-id option so their badge still renders.
 */
const useBranchFacetOptions = (
  orgId: string,
  projectId: string,
  branchFilter: readonly string[],
) => {
  const list = useServerSearchList((query) =>
    branchesQueryOptions(
      orgId,
      projectId,
      query ? { limit: DROPDOWN_FETCH_LIMIT, query } : { limit: DROPDOWN_FETCH_LIMIT },
    ),
  );

  const [labelCache, setLabelCache] = useState<ReadonlyMap<string, string>>(new Map());
  const rememberVisibleLabels = () => {
    setLabelCache((prev) => {
      const merged = new Map(prev);
      list.items.forEach((branch) => {
        merged.set(branch.id, branch.name);
      });
      return merged;
    });
  };

  const pageOptions = list.items.map((branch) => ({ label: branch.name, value: branch.id }));
  const fallbackOptions = branchFilter
    .filter((id) => !list.items.some((branch) => branch.id === id))
    .map((id) => ({
      value: id,
      label: labelCache.get(id) ?? `${id.slice(0, 8)}…`,
    }));

  return { list, options: [...pageOptions, ...fallbackOptions], rememberVisibleLabels };
};

export const UpdatesFilterBar = ({
  orgId,
  projectId,
  branchFilter,
  platformFilter,
  onBranchFilter,
  onPlatformFilter,
}: {
  orgId: string;
  projectId: string;
  branchFilter: readonly string[];
  platformFilter: readonly ("ios" | "android")[];
  onBranchFilter: (value: readonly string[]) => void;
  onPlatformFilter: (value: readonly ("ios" | "android")[]) => void;
}) => {
  const { list, options, rememberVisibleLabels } = useBranchFacetOptions(
    orgId,
    projectId,
    branchFilter,
  );

  return (
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
        options={options}
        selected={branchFilter}
        onChange={(next) => {
          rememberVisibleLabels();
          onBranchFilter(next);
        }}
        search={list.search}
        onSearchChange={list.handleSearchChange}
        isPending={list.isPending}
        defaultListTruncated={list.defaultListTruncated}
      />
    </>
  );
};
