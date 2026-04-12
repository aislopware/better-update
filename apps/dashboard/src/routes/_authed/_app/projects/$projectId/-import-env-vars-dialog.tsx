import { getApiError } from "@better-update/api-client";
import { bulkImportEnvVars } from "@better-update/api-client/react";
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
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Textarea } from "@better-update/ui/components/ui/textarea";
import { FileImportIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const lineCount = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#") && trimmed.includes("=");
  }).length;

  const handleSubmit = async () => {
    if (!content.trim()) {
      toast.error("Please paste .env content");
      return;
    }

    setIsSubmitting(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      const result = await bulkImportEnvVars({
        projectId,
        environment,
        content,
        visibility,
      });
      toast.success(
        `Imported: ${result.created} created, ${result.updated} updated${result.skipped > 0 ? `, ${result.skipped} skipped` : ""}`,
      );
      await queryClient.invalidateQueries({
        queryKey: ["org", orgId, "projects", projectId, "env-vars"],
      });
      setOpen(false);
      setContent("");
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsSubmitting(false);
    }
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
        <HugeiconsIcon icon={FileImportIcon} strokeWidth={2} className="size-4" />
        Import .env
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import environment variables</DialogTitle>
          <DialogDescription>
            Paste the contents of a .env file. Existing variables with the same key will be updated.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="env-content">Content</Label>
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
          </div>

          <div className="flex flex-col gap-2">
            <Label>Default visibility</Label>
            <Select
              value={visibility}
              onValueChange={(val) => {
                if (val) {
                  setVisibility(val);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="plaintext">Plaintext</SelectItem>
                <SelectItem value="sensitive">Sensitive</SelectItem>
                <SelectItem value="secret">Secret</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              All imported variables will use this visibility tier.
            </p>
          </div>
        </div>

        <DialogFooter>
          <DialogClose>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isSubmitting || lineCount === 0}>
            {isSubmitting
              ? "Importing..."
              : `Import ${lineCount} variable${lineCount === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
