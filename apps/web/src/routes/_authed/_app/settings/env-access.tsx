import { projectsQueryOptions } from "@better-update/api-client/react";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Skeleton } from "@better-update/ui/components/ui/skeleton";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { Suspense, useMemo } from "react";
import { z } from "zod";

import { PageHeader } from "../../../../components/page-header";
import { TableSkeleton } from "../../../../components/skeletons";
import { fireAndForget } from "../../../../lib/data-table";
import {
  ENV_GRANT_GLOBAL,
  envGrantsQueryOptions,
  membersQueryOptions,
} from "../../../../queries/org";
import { EnvAccessMatrix } from "./-env-access-matrix";

const PROJECTS_FETCH_LIMIT = 100;

const envAccessSearchSchema = z.object({
  // Selected project scope: a project id OR "global" (default).
  project: z.string().default(ENV_GRANT_GLOBAL),
});

const EnvAccessSkeleton = () => (
  <div className="flex flex-col gap-4">
    <Skeleton className="h-9 w-64 rounded-md" />
    <TableSkeleton columns={4} rows={4} hasFooter={false} />
  </div>
);

const ScopeSelect = ({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange: (next: string) => void;
}) => {
  const items = useMemo(
    (): Record<string, string> =>
      Object.fromEntries(options.map((option) => [option.value, option.label])),
    [options],
  );
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) {
          onChange(next);
        }
      }}
    >
      <SelectTrigger className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
};

const EnvAccessContent = () => {
  const { activeOrg } = Route.useRouteContext();
  const orgId = activeOrg.id;
  const { project } = Route.useSearch();
  const navigate = Route.useNavigate();

  const { data: projects } = useSuspenseQuery(
    projectsQueryOptions(orgId, { limit: PROJECTS_FETCH_LIMIT }),
  );
  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { data: grants } = useSuspenseQuery(envGrantsQueryOptions(project));

  const scopeOptions = useMemo(
    () => [
      { value: ENV_GRANT_GLOBAL, label: "Global (org-wide env vars)" },
      ...projects.items.map((item) => ({ value: item.id, label: item.name })),
    ],
    [projects.items],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-sm">Scope</span>
        <ScopeSelect
          value={project}
          options={scopeOptions}
          onChange={(next) => {
            fireAndForget(navigate({ search: (prev) => ({ ...prev, project: next }) }));
          }}
        />
      </div>
      <EnvAccessMatrix projectScope={project} members={members} grants={grants} />
    </div>
  );
};

const EnvAccessPage = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Environment access"
      description="Grant or deny each member's access to env vars per project and environment. Inherit falls back to the member's role permissions."
    />
    <Suspense fallback={<EnvAccessSkeleton />}>
      <EnvAccessContent />
    </Suspense>
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/env-access")({
  validateSearch: zodValidator(envAccessSearchSchema),
  component: EnvAccessPage,
});
