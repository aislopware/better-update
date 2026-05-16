import {
  bulkImportEnvVars,
  envVarsQueryKey,
  globalEnvVarsQueryKey,
} from "@better-update/api-client/react";
import { parseDotenvEntries } from "@better-update/dotenv";
import { Button } from "@better-update/ui/components/ui/button";
import {
  CardFrame,
  CardFrameAction,
  CardFrameHeader,
  CardFrameTitle,
} from "@better-update/ui/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogPopup,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { FileInputIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { EnvVarEnvironment, EnvVarVisibility } from "@better-update/api";

import { safeReadFileAsText } from "../-credentials-utils";
import { envVarKeySchema } from "../../../../lib/form-utils";
import { pluralize } from "../../../../lib/pluralize";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { ALL_ENVIRONMENTS, EnvironmentsPicker } from "./-environments-picker";

type CreateMode =
  | { readonly scope: "project"; readonly projectId: string }
  | { readonly scope: "global" };

const VISIBILITY_LABELS: Record<typeof EnvVarVisibility.Type, string> = {
  plaintext: "Plaintext",
  sensitive: "Sensitive",
};

interface FormRow {
  readonly id: string;
  readonly key: string;
  readonly value: string;
  readonly visibility: typeof EnvVarVisibility.Type;
}

const makeRow = (
  key = "",
  value = "",
  visibility: typeof EnvVarVisibility.Type = "plaintext",
): FormRow => ({
  id: crypto.randomUUID(),
  key,
  value,
  visibility,
});

const trimmedKey = (row: FormRow) => row.key.trim();

const validateKey = (key: string): string | undefined => {
  const result = envVarKeySchema.safeParse(key);
  return result.success ? undefined : result.error.issues[0]?.message;
};

const FileUploadButton = ({ onFile }: { onFile: (file: File) => Promise<void> }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".env,.txt,text/plain"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) {
            await onFile(file);
          }
          if (ref.current) {
            ref.current.value = "";
          }
        }}
      />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}>
        <FileInputIcon strokeWidth={2} data-icon="inline-start" />
        Upload .env
      </Button>
    </>
  );
};

const VisibilitySelect = ({
  value,
  onChange,
}: {
  value: typeof EnvVarVisibility.Type;
  onChange: (next: typeof EnvVarVisibility.Type) => void;
}) => (
  <Select
    items={VISIBILITY_LABELS}
    value={value}
    onValueChange={(val) => {
      if (val === "plaintext" || val === "sensitive") {
        onChange(val);
      }
    }}
  >
    <SelectTrigger className="w-32 shrink-0">
      <SelectValue />
    </SelectTrigger>
    <SelectPopup>
      <SelectGroup>
        <SelectItem value="plaintext">Plaintext</SelectItem>
        <SelectItem value="sensitive">Sensitive</SelectItem>
      </SelectGroup>
    </SelectPopup>
  </Select>
);

const RowInputs = ({
  row,
  duplicate,
  isOnly,
  onChange,
  onRemove,
}: {
  row: FormRow;
  duplicate: boolean;
  isOnly: boolean;
  onChange: (patch: Partial<FormRow>) => void;
  onRemove: () => void;
}) => {
  const keyError = trimmedKey(row).length > 0 ? validateKey(row.key) : undefined;
  const error = keyError ?? (duplicate ? "Duplicate key" : undefined);
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1">
        <Input
          placeholder="KEY"
          value={row.key}
          onChange={(event) => {
            onChange({ key: event.target.value.toUpperCase() });
          }}
          className="font-mono"
          aria-invalid={error ? true : undefined}
        />
        {error ? <p className="text-destructive mt-1 text-xs">{error}</p> : null}
      </div>
      <Input
        placeholder="value"
        value={row.value}
        onChange={(event) => {
          onChange({ value: event.target.value });
        }}
        className="flex-1 font-mono"
      />
      <VisibilitySelect
        value={row.visibility}
        onChange={(visibility) => {
          onChange({ visibility });
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        onClick={onRemove}
        disabled={isOnly && row.key.length === 0 && row.value.length === 0}
        aria-label="Remove row"
      >
        <TrashIcon strokeWidth={2} />
      </Button>
    </div>
  );
};

const RowsList = ({
  rows,
  duplicateKeys,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: readonly FormRow[];
  duplicateKeys: ReadonlySet<string>;
  onChange: (id: string, patch: Partial<FormRow>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) => (
  <div className="flex flex-col gap-3">
    <div className="flex flex-col gap-2">
      {rows.map((row) => (
        <RowInputs
          key={row.id}
          row={row}
          duplicate={trimmedKey(row).length > 0 && duplicateKeys.has(row.key)}
          isOnly={rows.length === 1}
          onChange={(patch) => {
            onChange(row.id, patch);
          }}
          onRemove={() => {
            onRemove(row.id);
          }}
        />
      ))}
    </div>
    <div>
      <Button type="button" variant="outline" onClick={onAdd}>
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add row
      </Button>
    </div>
  </div>
);

const buildEntries = (rows: readonly FormRow[]) =>
  rows
    .filter((row) => trimmedKey(row).length > 0)
    .map((row) => ({ key: row.key, value: row.value, visibility: row.visibility }));

const findDuplicates = (rows: readonly FormRow[]): ReadonlySet<string> => {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = trimmedKey(row);
    if (key.length === 0) {
      return;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
};

const formatImportSummary = (result: { created: number; updated: number; skipped: number }) => {
  const parts = [`${result.created} created`];
  if (result.updated > 0) {
    parts.push(`${result.updated} updated`);
  }
  if (result.skipped > 0) {
    parts.push(`${result.skipped} skipped`);
  }
  return parts.join(", ");
};

const CreateForm = ({
  orgId,
  mode,
  onSuccess,
}: {
  orgId: string;
  mode: CreateMode;
  onSuccess: () => void;
}) => {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<readonly FormRow[]>(() => [makeRow()]);
  const [environments, setEnvironments] =
    useState<readonly (typeof EnvVarEnvironment.Type)[]>(ALL_ENVIRONMENTS);

  const duplicateKeys = useMemo(() => findDuplicates(rows), [rows]);
  const entries = useMemo(() => buildEntries(rows), [rows]);
  const hasKeyError = rows.some((row) => {
    const key = trimmedKey(row);
    return key.length > 0 && (validateKey(row.key) !== undefined || duplicateKeys.has(row.key));
  });

  const handleFile = async (file: File) => {
    const text = await safeReadFileAsText(file);
    if (text === null) {
      toastManager.add({ title: "Failed to read file", type: "error" });
      return;
    }
    const parsed = parseDotenvEntries(text);
    if (parsed.length === 0) {
      toastManager.add({ title: "No valid entries in file", type: "error" });
      return;
    }
    setRows(parsed.map((entry) => makeRow(entry.key, entry.value, "plaintext")));
    toastManager.add({
      title: `Loaded ${parsed.length} ${pluralize(parsed.length, "variable")} from file`,
      type: "success",
    });
  };

  const mutation = useApiMutation({
    mutationFn: async (
      payload: readonly {
        key: string;
        value: string;
        visibility: typeof EnvVarVisibility.Type;
      }[],
    ) =>
      bulkImportEnvVars({
        scope: mode.scope,
        ...(mode.scope === "project" ? { projectId: mode.projectId } : {}),
        environments,
        entries: payload,
      }),
    onSuccess: async (result) => {
      toastManager.add({
        title: `Saved: ${formatImportSummary(result)}`,
        type: "success",
      });
      if (mode.scope === "project") {
        await queryClient.invalidateQueries({
          queryKey: envVarsQueryKey(orgId, mode.projectId),
        });
      }
      await queryClient.invalidateQueries({ queryKey: globalEnvVarsQueryKey(orgId) });
      onSuccess();
    },
  });

  const canSubmit =
    !mutation.isPending && environments.length > 0 && entries.length > 0 && !hasKeyError;

  const submitLabel = mutation.isPending
    ? "Adding..."
    : `Add ${entries.length > 0 ? entries.length : ""} ${pluralize(
        entries.length > 0 ? entries.length : 1,
        "variable",
      )}`.trim();

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          mutation.mutate(entries);
        }
      }}
    >
      <DialogPanel>
        <FieldGroup>
          <Field>
            <FieldLabel>Environments</FieldLabel>
            <EnvironmentsPicker value={environments} onChange={setEnvironments} />
          </Field>

          <CardFrame>
            <CardFrameHeader>
              <CardFrameTitle>Variables</CardFrameTitle>
              <CardFrameAction>
                <FileUploadButton onFile={handleFile} />
              </CardFrameAction>
            </CardFrameHeader>
            <div className="px-4 pb-4">
              <RowsList
                rows={rows}
                duplicateKeys={duplicateKeys}
                onChange={(id, patch) => {
                  setRows((current) =>
                    current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
                  );
                }}
                onRemove={(id) => {
                  setRows((current) =>
                    current.length === 1 ? [makeRow()] : current.filter((row) => row.id !== id),
                  );
                }}
                onAdd={() => {
                  setRows((current) => [...current, makeRow()]);
                }}
              />
            </div>
          </CardFrame>
        </FieldGroup>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!canSubmit}>
          <PlusIcon strokeWidth={2} data-icon="inline-start" />
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const CreateEnvVarDialog = ({ orgId, mode }: { orgId: string; mode: CreateMode }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
        Add variable
      </Button>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add environment variables</DialogTitle>
          <DialogDescription>
            {mode.scope === "project"
              ? "Add one or more variables scoped to this project. Upload a .env file to fill rows."
              : "Add one or more organization-wide variables. Upload a .env file to fill rows."}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateForm
            orgId={orgId}
            mode={mode}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
};
