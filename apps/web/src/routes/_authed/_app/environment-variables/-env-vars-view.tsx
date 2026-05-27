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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Label } from "@better-update/ui/components/ui/label";
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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FilterIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useMemo } from "react";
import { z } from "zod";

import type { EnvVarEnvironment, EnvVar } from "@better-update/api";
import type { EnvVarsFilters } from "@better-update/api-client/react";
import type { ChangeEvent } from "react";

import { TableSkeleton } from "../../../../components/skeletons";
import {
  enumParam,
  queryParam,
  stringArrayParam,
  useDebouncedSearch,
} from "../../../../lib/data-table";
import { pluralize } from "../../../../lib/pluralize";
import { EnvVarRow } from "./-env-var-row";
import { ENV_LABELS } from "./-env-vars-labels";
import { ALL_ENVIRONMENTS } from "./-environments-picker";

type Mode =
  | { readonly kind: "project"; readonly orgId: string; readonly projectId: string }
  | { readonly kind: "global"; readonly orgId: string };

const SCOPE_VALUES = ["all", "project", "global"] as const;
type ScopeFilter = (typeof SCOPE_VALUES)[number];

const SCOPE_LABELS: Record<ScopeFilter, string> = {
  all: "All scopes",
  project: "Project only",
  global: "Global only",
};

const ENV_VALUES = ["development", "preview", "production"] as const;

export const envVarsSearchSchema = z.object({
  query: queryParam(),
  scope: enumParam(SCOPE_VALUES, "all"),
  environments: stringArrayParam(ENV_VALUES, [...ALL_ENVIRONMENTS]),
});

export type EnvVarsSearch = z.infer<typeof envVarsSearchSchema>;

const SEARCH_DEBOUNCE_MS = 300;

const isScopeFilter = (value: string): value is ScopeFilter =>
  (SCOPE_VALUES as readonly string[]).includes(value);

const isEnvironment = (value: string): value is typeof EnvVarEnvironment.Type =>
  (ENV_VALUES as readonly string[]).includes(value);

const EmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SettingsIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No environment variables</EmptyTitle>
      <EmptyDescription>
        Set variables from the CLI with <code>better-update env set</code>.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

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
            <Label key={env} className="cursor-pointer gap-2 select-none">
              <Checkbox name={env} />
              {ENV_LABELS[env]}
            </Label>
          ))}
        </CheckboxGroup>
      </PopoverPopup>
    </Popover>
  );
};

const Toolbar = ({
  mode,
  searchDraft,
  onSearchDraftChange,
  scope,
  onScopeChange,
  environments,
  onEnvironmentsChange,
}: {
  mode: Mode;
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  scope: ScopeFilter;
  onScopeChange: (value: ScopeFilter) => void;
  environments: readonly (typeof EnvVarEnvironment.Type)[];
  onEnvironmentsChange: (value: readonly (typeof EnvVarEnvironment.Type)[]) => void;
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <InputGroup className="w-56">
      <InputGroupAddon>
        <SearchIcon aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Search environment variables"
        placeholder="Search by key"
        type="search"
        value={searchDraft}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onSearchDraftChange(event.target.value);
        }}
      />
    </InputGroup>
    <EnvFilterPopover value={environments} onChange={onEnvironmentsChange} />
    {mode.kind === "project" ? (
      <Select
        items={SCOPE_LABELS}
        value={scope}
        onValueChange={(val) => {
          if (val && isScopeFilter(val)) {
            onScopeChange(val);
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
);

const EnvVarsTable = ({ items }: { items: readonly (typeof EnvVar.Type)[] }) =>
  items.length === 0 ? (
    <EmptyState />
  ) : (
    <CardFrame>
      <Table variant="card">
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Revisions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((envVar) => (
            <EnvVarRow key={envVar.id} envVar={envVar} />
          ))}
        </TableBody>
      </Table>
    </CardFrame>
  );

export const EnvVarsView = ({
  mode,
  search,
  onChangeSearch,
}: {
  mode: Mode;
  search: EnvVarsSearch;
  onChangeSearch: (next: EnvVarsSearch) => void;
}) => {
  const { query, scope, environments } = search;

  const { draft: searchDraft, setDraft: onSearchDraftChange } = useDebouncedSearch({
    initial: query,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      onChangeSearch({ ...search, query: value });
    },
  });

  const filters = useMemo<EnvVarsFilters>(() => {
    const filteredEnvs =
      environments.length > 0 && environments.length < ALL_ENVIRONMENTS.length
        ? environments
        : undefined;
    return {
      ...(mode.kind === "project" ? { scope } : {}),
      ...(filteredEnvs ? { environments: filteredEnvs } : {}),
      ...(query.trim() ? { search: query.trim() } : {}),
    };
  }, [environments, mode.kind, scope, query]);

  const queryOptions =
    mode.kind === "project"
      ? envVarsQueryOptions(mode.orgId, mode.projectId, filters)
      : globalEnvVarsQueryOptions(mode.orgId, filters);

  const { data, isLoading } = useQuery({
    ...queryOptions,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        mode={mode}
        searchDraft={searchDraft}
        onSearchDraftChange={onSearchDraftChange}
        scope={scope}
        onScopeChange={(next) => {
          onChangeSearch({ ...search, scope: next });
        }}
        environments={environments}
        onEnvironmentsChange={(next) => {
          onChangeSearch({ ...search, environments: [...next] });
        }}
      />
      <p className="text-muted-foreground text-sm">
        Values are end-to-end encrypted and managed from the CLI —{" "}
        <code className="font-mono">better-update env set</code> /{" "}
        <code className="font-mono">env pull</code>. The dashboard shows metadata only.
      </p>
      {isLoading || !data ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full rounded-md" />
          <TableSkeleton variant="card" columns={5} rows={4} hasFooter={false} />
        </div>
      ) : (
        <EnvVarsTable items={data.items} />
      )}
    </div>
  );
};
