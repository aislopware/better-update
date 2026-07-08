import { envVarsQueryOptions, globalEnvVarsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { FingerprintIcon, LockKeyholeIcon, SettingsIcon } from "lucide-react";
import { useCallback, useMemo } from "react";
import { z } from "zod";

import type { EnvVar } from "@better-update/api";
import type { EnvVarsFilters } from "@better-update/api-client/react";

import { QueryErrorState } from "../../../../components/query-error-state";
import { TableSkeleton } from "../../../../components/skeletons";
import {
  DataTableFacetedFilter,
  DataTableToolbar,
  enumArrayParam,
  freeStringArrayParam,
  queryParam,
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

const isScopeFilter = (value: string): value is ScopeFilter =>
  (SCOPE_VALUES as readonly string[]).includes(value);

const EmptyState = () => (
  <Card>
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
  </Card>
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
        variant="outline"
        disabled={reverifyMutation.isPending}
        onClick={() => {
          reverifyMutation.mutate();
        }}
      >
        {reverifyMutation.isPending ? (
          <Spinner data-icon="inline-start" />
        ) : (
          <FingerprintIcon strokeWidth={2} data-icon="inline-start" />
        )}
        Re-verify
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          vault.lock();
        }}
      >
        <LockKeyholeIcon strokeWidth={2} data-icon="inline-start" />
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
  vault,
  invalidate,
}: {
  items: readonly EnvVar[];
  orgId: string;
  vault: EnvVaultController;
  invalidate: () => Promise<void>;
}) =>
  items.length === 0 ? (
    <EmptyState />
  ) : (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Scope</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Revisions</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((envVar) => (
            <EnvVarRow
              key={envVar.id}
              envVar={envVar}
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
    </div>
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
          <TableSkeleton columns={7} rows={4} hasFooter={false} />
        </div>
      );
    }
    return (
      <EnvVarsTable
        items={data.items}
        orgId={mode.orgId}
        vault={vault}
        invalidate={invalidateEnvVars}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
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
      <p className="text-muted-foreground text-sm">
        Values are end-to-end encrypted and managed from the CLI —{" "}
        <code className="font-mono">better-update env set</code> /{" "}
        <code className="font-mono">env pull</code>. You can still edit each variable&rsquo;s label
        and description here (non-secret documentation) from the row menu.
      </p>
      {renderContent()}
    </div>
  );
};
