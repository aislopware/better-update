import { envVarsQueryOptions } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent } from "@better-update/ui/components/ui/card";
import {
  Select,
  SelectContent,
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
import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { EnvVar } from "@better-update/api";

import { CreateEnvVarDialog } from "./-create-env-var-dialog";
import { EnvVarRow } from "./-env-var-row";
import { ImportEnvVarsDialog } from "./-import-env-vars-dialog";

const ENVIRONMENTS = [
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
  { value: "*", label: "Shared (all envs)" },
];

const EnvVarsEmptyState = () => (
  <Card className="border-dashed">
    <CardContent className="flex flex-col items-center justify-center py-12">
      <HugeiconsIcon
        icon={Settings02Icon}
        strokeWidth={1.5}
        className="text-muted-foreground mb-4 size-12"
      />
      <p className="text-lg font-medium">No environment variables</p>
      <p className="text-muted-foreground mt-1 text-sm">
        Add variables to configure your builds for this environment.
      </p>
    </CardContent>
  </Card>
);

const ExportButton = ({ items }: { items: readonly (typeof EnvVar.Type)[] }) => {
  const plaintextItems = items.filter((item) => item.visibility === "plaintext");

  const handleExport = () => {
    const content = plaintextItems.map((item) => `${item.key}=${item.value ?? ""}`).join("\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ".env";
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(
      `Exported ${plaintextItems.length} plaintext variable${plaintextItems.length === 1 ? "" : "s"}`,
    );
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
          <SelectContent>
            {ENVIRONMENTS.map((env) => (
              <SelectItem key={env.value} value={env.value}>
                {env.label}
              </SelectItem>
            ))}
          </SelectContent>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((envVar) => (
              <EnvVarRow key={envVar.id} envVar={envVar} orgId={orgId} projectId={projectId} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
};
