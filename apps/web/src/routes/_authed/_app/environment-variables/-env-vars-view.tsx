import { envVarsQueryOptions, globalEnvVarsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/button";
import { Empty } from "@better-update/ui/components/empty";
import { InlineCode } from "@better-update/ui/components/inline-code";
import { Skeleton } from "@better-update/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/table";
import { toast } from "@better-update/ui/components/toast";
import { FingerprintIcon, GearIcon, LockKeyIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { z } from "zod";

import type { EnvVar } from "@better-update/api";
import type { EnvVarsFilters } from "@better-update/api-client/react";

import { CliCommandBlock } from "../../../../components/cli-command-block";
import { SectionHeader } from "../../../../components/page-header";
import { QueryErrorState } from "../../../../components/query-error-state";
import { TableSkeleton } from "../../../../components/skeletons";
import {
  ClientPaginationBar,
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  freeStringArrayParam,
  ListPanel,
  ListPanelFooter,
  PRIMARY_COLUMN_CLASS,
  queryParam,
  useClientPagination,
  useDebouncedSearch,
} from "../../../../lib/data-table";
import { runPasskeyStepUp } from "../../../../lib/env-vault/step-up";
import { useEnvVault } from "../../../../lib/env-vault/use-env-vault";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { EnvVarCreateDialog } from "./-env-var-create-dialog";
import { EnvVarRow } from "./-env-var-row";
import { EnvVarRowActions } from "./-env-var-row-actions";
import { formatEnvironmentLabel } from "./-env-vars-labels";
import { useEnvironmentNames } from "./-environments-picker";
import { VaultSetupActions } from "./-vault-setup-actions";

import type { EnvVaultController } from "../../../../lib/env-vault/use-env-vault";

type Mode =
  | { readonly kind: "project"; readonly orgId: string; readonly projectId: string }
  | { readonly kind: "global"; readonly orgId: string };

const SCOPE_VALUES = ["project", "global"] as const;
type ScopeFilter = (typeof SCOPE_VALUES)[number];

// An empty (or full) chip selection means "all scopes".
const SCOPE_OPTIONS = [
  { label: "Project only", value: "project" },
  { label: "Global only", value: "global" },
] as const;

export const envVarsSearchSchema = z.object({
  query: queryParam(),
  scope: enumArrayParam(SCOPE_VALUES),
  // Any of the org's environments (built-in or user-defined); an empty list means
  // "all environments" (no filter), so it stays valid as custom environments change.
  environments: freeStringArrayParam(),
});

export type EnvVarsSearch = z.infer<typeof envVarsSearchSchema>;

const SEARCH_DEBOUNCE_MS = 300;

// One line, not three. The old note also spelled out that a row's menu edits
// its label and description — an instruction for an affordance every other list
// in the dashboard carries without one, and the sentence cost more width than
// the ⋮ it was pointing at.
const ENCRYPTION_NOTE = (
  <>
    End-to-end encrypted and set from the CLI — <InlineCode>better-update env set</InlineCode> /{" "}
    <InlineCode>env pull</InlineCode>.
  </>
);

const isScopeFilter = (value: string): value is ScopeFilter =>
  (SCOPE_VALUES as readonly string[]).includes(value);

const EmptyState = () => (
  <Empty
    icon={<GearIcon className="text-kumo-inactive size-10" />}
    title="No environment variables"
    description="Set variables from the CLI — values are end-to-end encrypted and versioned per environment."
    contents={
      <CliCommandBlock commands={["better-update env set API_URL=https://api.example.com"]} />
    }
  />
);

// Multi-select environment filter — options are the org's environments
// (built-in + user-defined), so they load via the environments query hook.
const EnvironmentsFilter = ({
  orgId,
  value,
  onChange,
}: {
  orgId: string;
  value: readonly string[];
  onChange: (next: readonly string[]) => void;
}) => {
  const environmentNames = useEnvironmentNames(orgId);
  const options = useMemo(
    () => environmentNames.map((env) => ({ value: env, label: formatEnvironmentLabel(env) })),
    [environmentNames],
  );
  return (
    <DataTableFacetedFilter
      title="Environment"
      options={options}
      selected={value}
      onChange={onChange}
    />
  );
};

// Unlock / lock / add controls — rendered only on the dedicated vault origin
// (`vault.enabled`). Locked: a single unlock entry point. Unlocked: create + lock.
const VaultToolbarActions = ({
  mode,
  vault,
  invalidate,
}: {
  mode: Mode;
  vault: EnvVaultController;
  invalidate: () => Promise<void>;
}) => {
  // Re-prove the passkey step-up (the server gate expires after ~10 min) WITHOUT
  // re-entering the passphrase — the unwrapped vault key is still cached, only the
  // server-side step-up needs refreshing. Lets a long-open session recover from a
  // 403 without the full Lock → Unlock dance.
  const reverifyMutation = useApiMutation({
    mutationFn: async () => runPasskeyStepUp(),
    onSuccess: () => {
      toast.success("Re-verified with your passkey");
    },
  });

  if (!vault.enabled) {
    return null;
  }
  if (!vault.unlocked) {
    return (
      <VaultSetupActions
        orgId={mode.orgId}
        onUnlocked={(unlockedVault) => {
          vault.onUnlocked(unlockedVault);
        }}
      />
    );
  }
  return (
    <>
      <EnvVarCreateDialog
        orgId={mode.orgId}
        scope={mode.kind === "project" ? "project" : "global"}
        projectId={mode.kind === "project" ? mode.projectId : undefined}
        vault={vault.unlocked}
        invalidate={invalidate}
      />
      <Button
        variant="secondary"
        disabled={reverifyMutation.isPending}
        onClick={() => {
          reverifyMutation.mutate();
        }}
        loading={reverifyMutation.isPending}
        icon={<FingerprintIcon weight="bold" />}
      >
        Re-verify
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          vault.lock();
        }}
      >
        <LockKeyIcon weight="bold" />
        Lock
      </Button>
    </>
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
  isFiltered,
  onReset,
  vault,
  invalidate,
}: {
  mode: Mode;
  searchDraft: string;
  onSearchDraftChange: (value: string) => void;
  scope: readonly ScopeFilter[];
  onScopeChange: (value: readonly ScopeFilter[]) => void;
  environments: readonly string[];
  onEnvironmentsChange: (value: readonly string[]) => void;
  isFiltered: boolean;
  onReset: () => void;
  vault: EnvVaultController;
  invalidate: () => Promise<void>;
}) => (
  <DataTableToolbar
    search={{ value: searchDraft, onChange: onSearchDraftChange, placeholder: "Search by key" }}
    isFiltered={isFiltered}
    onReset={onReset}
    actions={<VaultToolbarActions mode={mode} vault={vault} invalidate={invalidate} />}
  >
    <EnvironmentsFilter orgId={mode.orgId} value={environments} onChange={onEnvironmentsChange} />
    {mode.kind === "project" ? (
      <DataTableFacetedFilter
        title="Scope"
        options={SCOPE_OPTIONS}
        selected={scope}
        onChange={(next) => {
          onScopeChange(next.filter(isScopeFilter));
        }}
      />
    ) : null}
  </DataTableToolbar>
);

const EnvVarsTable = ({
  items,
  orgId,
  showScope,
  vault,
  invalidate,
}: {
  items: readonly EnvVar[];
  orgId: string;
  showScope: boolean;
  vault: EnvVaultController;
  invalidate: () => Promise<void>;
}) => {
  const pagination = useClientPagination(items, "variable");
  if (items.length === 0) {
    return <EmptyState />;
  }
  return (
    <ListPanel>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={PRIMARY_COLUMN_CLASS}>Key</TableHead>
            <TableHead>Environment</TableHead>
            {showScope ? <TableHead>Scope</TableHead> : null}
            <TableHead>Visibility</TableHead>
            <TableHead className="text-right">Revisions</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pagination.pageItems.map((envVar, index) => (
            <EnvVarRow
              key={envVar.id}
              envVar={envVar}
              showScope={showScope}
              // The list is ordered by key, so a variable defined in three
              // environments arrives as three adjacent rows. Its definition is
              // written once, at the top of the run.
              documentedAbove={
                pagination.pageItems[index - 1]?.key === envVar.key &&
                pagination.pageItems[index - 1]?.scope === envVar.scope
              }
              hasActions
              actions={
                // Editing the label/description needs no vault, so the row menu is
                // always available; value actions inside it unlock with the vault.
                <EnvVarRowActions
                  envVar={envVar}
                  orgId={orgId}
                  vault={vault.unlocked}
                  invalidate={invalidate}
                />
              }
            />
          ))}
        </TableBody>
      </Table>
      <ListPanelFooter>
        <ClientPaginationBar state={pagination} />
      </ListPanelFooter>
    </ListPanel>
  );
};

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
  // Only a project's list mixes project rows with inherited globals.
  const showScope = mode.kind === "project";

  const vault = useEnvVault(mode.orgId);
  const queryClient = useQueryClient();
  // Invalidate the global env-vars list AND every project's list for this org:
  // global vars are merged into each project's view, so a global-scope mutation
  // (or editing an inherited global row from a project view) can change any of
  // them. Scoped to env-var list keys so unrelated org queries aren't refetched.
  const invalidateEnvVars = useCallback(
    async () =>
      queryClient.invalidateQueries({
        predicate: ({ queryKey: key }) => {
          if (key[0] !== "org" || key[1] !== mode.orgId) {
            return false;
          }
          return key[2] === "global-env-vars" || (key[2] === "projects" && key[4] === "env-vars");
        },
      }),
    [queryClient, mode.orgId],
  );

  const { draft: searchDraft, setDraft: onSearchDraftChange } = useDebouncedSearch({
    initial: query,
    delayMs: SEARCH_DEBOUNCE_MS,
    onCommit: (value) => {
      onChangeSearch({ ...search, query: value });
    },
  });

  const filters = useMemo<EnvVarsFilters>(() => {
    const filteredEnvs = environments.length > 0 ? environments : undefined;
    // Both scopes selected ≡ no scope filter — the API keeps its tri-state param.
    const scopeParam = scope.length === 1 ? scope[0] : "all";
    return {
      ...(mode.kind === "project" ? { scope: scopeParam } : {}),
      ...(filteredEnvs ? { environments: filteredEnvs } : {}),
      ...(query.trim() ? { search: query.trim() } : {}),
    };
  }, [environments, mode.kind, scope, query]);

  const queryOptions =
    mode.kind === "project"
      ? envVarsQueryOptions(mode.orgId, mode.projectId, filters)
      : globalEnvVarsQueryOptions(mode.orgId, filters);

  const { data, error, isLoading, refetch } = useQuery({
    ...queryOptions,
    placeholderData: keepPreviousData,
  });

  const renderContent = () => {
    if (error && !data) {
      return <QueryErrorState error={error} onRetry={refetch} />;
    }
    if (isLoading || !data) {
      return (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full rounded-md" />
          <TableSkeleton columns={showScope ? 7 : 6} rows={4} hasFooter={false} />
        </div>
      );
    }
    return (
      <EnvVarsTable
        // Filter identity as key: a search/scope/environment change remounts the
        // table so client pagination resets to page 1.
        key={JSON.stringify(filters)}
        items={data.items}
        orgId={mode.orgId}
        showScope={showScope}
        vault={vault}
        invalidate={invalidateEnvVars}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* The organization page puts this list under the environments panel, so
          the list needs naming and the note hangs off that name. On a project
          page the list is the page: it already has a title with a line under
          it, and a second grey paragraph beneath the first only looked like the
          header had been written twice — that page's own description carries
          the note instead. */}
      {mode.kind === "global" ? (
        <SectionHeader title="Variables" description={ENCRYPTION_NOTE} />
      ) : null}
      <Toolbar
        mode={mode}
        searchDraft={searchDraft}
        onSearchDraftChange={onSearchDraftChange}
        scope={scope}
        onScopeChange={(next) => {
          onChangeSearch({ ...search, scope: [...next] });
        }}
        environments={environments}
        onEnvironmentsChange={(next) => {
          onChangeSearch({ ...search, environments: [...next] });
        }}
        isFiltered={query.length > 0 || environments.length > 0 || scope.length > 0}
        onReset={() => {
          onSearchDraftChange("");
          onChangeSearch({ query: "", scope: [], environments: [] });
        }}
        vault={vault}
        invalidate={invalidateEnvVars}
      />
      {renderContent()}
    </div>
  );
};
