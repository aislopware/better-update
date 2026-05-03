import { envVarsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { CardFrame } from "@better-update/ui/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@better-update/ui/components/ui/empty";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@better-update/ui/components/ui/table";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useSuspenseQuery } from "@tanstack/react-query";
import { SettingsIcon } from "lucide-react";
import { useState } from "react";

import type { EnvVar } from "@better-update/api";

import { pluralize } from "../../../../../lib/pluralize";
import { CreateEnvVarDialog } from "./-create-env-var-dialog";
import { EnvVarRow } from "./-env-var-row";
import { ImportEnvVarsDialog } from "./-import-env-vars-dialog";

const ENVIRONMENTS = [
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
  { value: "*", label: "Shared (all envs)" },
];

const ENVIRONMENT_LABELS: Record<string, string> = Object.fromEntries(
  ENVIRONMENTS.map((env) => [env.value, env.label]),
);

const EnvVarsEmptyState = () => (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <SettingsIcon strokeWidth={1.5} />
      </EmptyMedia>
      <EmptyTitle>No environment variables</EmptyTitle>
      <EmptyDescription>
        Add variables to configure your builds for this environment.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const ExportButton = ({ items }: { items: readonly (typeof EnvVar.Type)[] }) => {
  const plaintextItems = items.filter((item) => item.visibility === "plaintext");

  const handleExport = () => {
    // eslint-disable-next-line eslint-js/no-restricted-syntax -- EnvVar.value schema is nullable at storage; plaintext export renders empty when missing
    const content = plaintextItems.map((item) => `${item.key}=${item.value ?? ""}`).join("\n");

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

export const EnvVarsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => {
  const [environment, setEnvironment] = useState("development");
  const { data } = useSuspenseQuery(envVarsQueryOptions(orgId, projectId, environment));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <Select
          items={ENVIRONMENT_LABELS}
          value={environment}
          onValueChange={(value) => {
            if (value) {
              setEnvironment(value);
            }
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {ENVIRONMENTS.map((env) => (
                <SelectItem key={env.value} value={env.value}>
                  {env.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>

        <div className="flex gap-2">
          <ExportButton items={data.items} />
          <ImportEnvVarsDialog orgId={orgId} projectId={projectId} environment={environment} />
          <CreateEnvVarDialog orgId={orgId} projectId={projectId} environment={environment} />
        </div>
      </div>

      {data.items.length === 0 ? (
        <EnvVarsEmptyState />
      ) : (
        <CardFrame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((envVar) => (
                <EnvVarRow key={envVar.id} envVar={envVar} orgId={orgId} projectId={projectId} />
              ))}
            </TableBody>
          </Table>
        </CardFrame>
      )}
    </div>
  );
};
