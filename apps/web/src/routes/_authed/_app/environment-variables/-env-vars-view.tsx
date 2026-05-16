import { envVarsQueryOptions, globalEnvVarsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { CardFrame } from "@better-update/ui/components/ui/card";
import { Checkbox } from "@better-update/ui/components/ui/checkbox";
import { CheckboxGroup } from "@better-update/ui/components/ui/checkbox-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Input } from "@better-update/ui/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@better-update/ui/components/ui/popover";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";

import type { EnvVarEnvironment, EnvVar } from "@better-update/api";
import type { EnvVarsFilters } from "@better-update/api-client/react";

import { TableSkeleton } from "../../../../components/skeletons";
import { pluralize } from "../../../../lib/pluralize";
import { CreateEnvVarDialog } from "./-create-env-var-dialog";
import { EnvVarRow } from "./-env-var-row";
import { ALL_ENVIRONMENTS } from "./-environments-picker";

type Mode =
  | { readonly kind: "project"; readonly orgId: string; readonly projectId: string }
  | { readonly kind: "global"; readonly orgId: string };

type ScopeFilter = "all" | "project" | "global";

const SCOPE_LABELS: Record<ScopeFilter, string> = {
  all: "All scopes",
  project: "Project only",
  global: "Global only",
};

const ENV_LABELS: Record<typeof EnvVarEnvironment.Type, string> = {
  development: "Development",
  preview: "Preview",
  production: "Production",
};

const isScopeFilter = (value: string): value is ScopeFilter =>
  value === "all" || value === "project" || value === "global";

const isEnvironment = (value: string): value is typeof EnvVarEnvironment.Type =>
  value === "development" || value === "preview" || value === "production";

const EmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SettingsIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No environment variables</EmptyTitle>
      <EmptyDescription>Add variables to configure your builds and deployments.</EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const ExportButton = ({ items }: { items: readonly (typeof EnvVar.Type)[] }) => {
  const plaintextItems = items.filter((item) => item.visibility === "plaintext");
  const handleExport = () => {
    const content = plaintextItems
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value schema is nullable at storage; plaintext export renders empty when missing
      .map((item) => `${item.key}=${item.value ?? ""}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ".env";
    anchor.click();
    URL.revokeObjectURL(url);
    toastManager.add({
      title: `Exported ${plaintextItems.length} plaintext ${pluralize(plaintextItems.length, "variable")}`,
      type: "success",
    });
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={plaintextItems.length === 0}>
      Export .env
    </Button>
  );
};

const EnvFilterPopover = ({
  value,
  onChange,
}: {
  value: readonly (typeof EnvVarEnvironment.Type)[];
  onChange: (next: readonly (typeof EnvVarEnvironment.Type)[]) => void;
}) => {
  const label =
    value.length === ALL_ENVIRONMENTS.length || value.length === 0
      ? "All environments"
      : `${value.length} ${pluralize(value.length, "environment")}`;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline">
            <FilterIcon strokeWidth={2} data-icon="inline-start" />
            {label}
          </Button>
        }
      />
      <PopoverPopup>
        <CheckboxGroup
          className="gap-2 p-2 text-sm"
          value={[...value]}
          onValueChange={(next) => {
            onChange(next.filter(isEnvironment));
          }}
        >
          {ALL_ENVIRONMENTS.map((env) => (
            <label key={env} className="flex cursor-pointer items-center gap-2 select-none">
              <Checkbox name={env} />
              {ENV_LABELS[env]}
            </label>
          ))}
        </CheckboxGroup>
      </PopoverPopup>
    </Popover>
  );
};

const Toolbar = ({
  mode,
  search,
  setSearch,
  scope,
  setScope,
  environments,
  setEnvironments,
  items,
}: {
  mode: Mode;
  search: string;
  setSearch: (value: string) => void;
  scope: ScopeFilter;
  setScope: (value: ScopeFilter) => void;
  environments: readonly (typeof EnvVarEnvironment.Type)[];
  setEnvironments: (value: readonly (typeof EnvVarEnvironment.Type)[]) => void;
  items: readonly (typeof EnvVar.Type)[];
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="Search by key"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
        className="w-56"
      />
      <EnvFilterPopover value={environments} onChange={setEnvironments} />
      {mode.kind === "project" ? (
        <Select
          items={SCOPE_LABELS}
          value={scope}
          onValueChange={(val) => {
            if (val && isScopeFilter(val)) {
              setScope(val);
            }
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              <SelectItem value="all">All scopes</SelectItem>
              <SelectItem value="project">Project only</SelectItem>
              <SelectItem value="global">Global only</SelectItem>
            </SelectGroup>
          </SelectPopup>
        </Select>
      ) : null}
    </div>
    <div className="flex gap-2">
      {mode.kind === "project" ? <ExportButton items={items} /> : null}
      <CreateEnvVarDialog
        orgId={mode.orgId}
        mode={
          mode.kind === "project"
            ? { scope: "project", projectId: mode.projectId }
            : { scope: "global" }
        }
      />
    </div>
  </div>
);

const EnvVarsTable = ({
  items,
  orgId,
  projectId,
  manageMode,
}: {
  items: readonly (typeof EnvVar.Type)[];
  orgId: string;
  projectId: string | undefined;
  manageMode: "all" | "scope-only";
}) =>
  items.length === 0 ? (
    <EmptyState />
  ) : (
    <CardFrame>
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Environments</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((envVar) => (
            <EnvVarRow
              key={envVar.id}
              envVar={envVar}
              orgId={orgId}
              projectId={projectId}
              manageMode={manageMode}
            />
          ))}
        </TableBody>
      </Table>
    </CardFrame>
  );

export const EnvVarsView = ({ mode }: { mode: Mode }) => {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<ScopeFilter>(mode.kind === "project" ? "all" : "global");
  const [environments, setEnvironments] =
    useState<readonly (typeof EnvVarEnvironment.Type)[]>(ALL_ENVIRONMENTS);

  const filters = useMemo<EnvVarsFilters>(() => {
    const filteredEnvs =
      environments.length > 0 && environments.length < ALL_ENVIRONMENTS.length
        ? environments
        : undefined;
    return {
      ...(mode.kind === "project" ? { scope } : {}),
      ...(filteredEnvs ? { environments: filteredEnvs } : {}),
      ...(search.trim() ? { search: search.trim() } : {}),
    };
  }, [environments, mode.kind, scope, search]);

  const projectQuery = useQuery({
    ...envVarsQueryOptions(
      mode.orgId,
      mode.kind === "project" ? mode.projectId : "__never__",
      filters,
    ),
    enabled: mode.kind === "project",
    placeholderData: keepPreviousData,
  });
  const globalQuery = useQuery({
    ...globalEnvVarsQueryOptions(mode.orgId, filters),
    enabled: mode.kind === "global",
    placeholderData: keepPreviousData,
  });

  const data = mode.kind === "project" ? projectQuery.data : globalQuery.data;
  const isLoading = mode.kind === "project" ? projectQuery.isLoading : globalQuery.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        mode={mode}
        search={search}
        setSearch={setSearch}
        scope={scope}
        setScope={setScope}
        environments={environments}
        setEnvironments={setEnvironments}
        items={data?.items ?? []}
      />
      {isLoading || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full rounded-md" />
          <TableSkeleton variant="card" columns={6} rows={4} hasFooter={false} />
        </div>
      ) : (
        <EnvVarsTable
          items={data.items}
          orgId={mode.orgId}
          projectId={mode.kind === "project" ? mode.projectId : undefined}
          manageMode={mode.kind === "project" ? "scope-only" : "all"}
        />
      )}
    </div>
  );
};
