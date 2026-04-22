import { bulkImportEnvVars, envVarsQueryKey } from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { FileInputIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useApiMutation } from "../../../../../lib/use-api-mutation";

const VISIBILITY_LABELS: Record<string, string> = {
  plaintext: "Plaintext",
  sensitive: "Sensitive",
  secret: "Secret",
};

export const ImportEnvVarsDialog = ({
  orgId,
  projectId,
  environment,
}: {
  orgId: string;
  projectId: string;
  environment: string;
}) => {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<"plaintext" | "sensitive" | "secret">("plaintext");
  const queryClient = useQueryClient();
  const importEnvVarsMutation = useApiMutation({
    mutationFn: async () =>
      bulkImportEnvVars({
        projectId,
        environment,
        content,
        visibility,
      }),
    onSuccess: async (result) => {
      toast.success(
        `Imported: ${result.created} created, ${result.updated} updated${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}`,
      );
      await queryClient.invalidateQueries({
        queryKey: envVarsQueryKey(orgId, projectId),
      });
      setOpen(false);
      setContent("");
    },
  });

  const lineCount = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes("=");
  }).length;

  const handleSubmit = () => {
    if (!content.trim()) {
      toast.error("Please paste .env content");
      return;
    }

    importEnvVarsMutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        setOpen(val);
        if (!val) {
          setContent("");
        }
      }}
    >
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        <FileInputIcon strokeWidth={2} data-icon="inline-start" />
        Import .env
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import environment variables</DialogTitle>
          <DialogDescription>
            Paste the contents of a .env file. Existing variables with the same key will be updated.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup className="py-4">
          <Field>
            <FieldLabel htmlFor="env-content">Content</FieldLabel>
            <Textarea
              id="env-content"
              placeholder={
                "# API configuration\nEXPO_PUBLIC_API_URL=https://api.example.com\nSENTRY_AUTH_TOKEN=xxx"
              }
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
              }}
              rows={8}
              className="font-mono text-sm"
            />
            {lineCount > 0 ? (
              <p className="text-muted-foreground text-xs">
                {lineCount} variable{lineCount === 1 ? "" : "s"} detected
              </p>
            ) : null}
          </Field>

          <Field>
            <FieldLabel>Default visibility</FieldLabel>
            <Select
              items={VISIBILITY_LABELS}
              value={visibility}
              onValueChange={(val) => {
                if (val === "plaintext" || val === "sensitive" || val === "secret") {
                  setVisibility(val);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="plaintext">Plaintext</SelectItem>
                  <SelectItem value="sensitive">Sensitive</SelectItem>
                  <SelectItem value="secret">Secret</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              All imported variables will use this visibility tier.
            </p>
          </Field>
        </FieldGroup>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            onClick={handleSubmit}
            disabled={importEnvVarsMutation.isPending || lineCount === 0}
          >
            {importEnvVarsMutation.isPending
              ? "Importing..."
              : `Import ${lineCount} variable${lineCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
