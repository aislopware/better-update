import { Button } from "@better-update/ui/components/ui/button";
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { KeyIcon, CopyIcon, CheckIcon } from "lucide-react";
import { useRef, useState } from "react";

import { authClient } from "../../../lib/auth-client";
import { getFieldError, requiredStringSchema } from "../../../lib/form-utils";
import { useCopyToClipboard } from "../../../lib/use-copy-to-clipboard";
import { apiKeysQueryOptions } from "../../../queries/api-keys";

// ── Create Form ──────────────────────────────────────────────────

const CreateFormContent = ({
  orgId,
  onSuccess,
}: {
  orgId: string;
  onSuccess: (key: string) => Promise<void>;
}) => {
  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      const { data, error } = await authClient.apiKey.create({
        name: value.name,
        organizationId: orgId,
      });

      if (error) {
        toastManager.add({ title: error.message ?? "Failed to create API key", type: "error" });
        return;
      }

      if (data.key) {
        await onSuccess(data.key);
      }
    },
  });

  return (
    <form
      className="contents"
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <DialogPanel>
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) => {
              const result = requiredStringSchema.safeParse(value);
              return result.success ? undefined : result.error.issues[0]?.message;
            },
          }}
        >
          {(field) => {
            const errorMessage = getFieldError(field);
            return (
              <Field data-invalid={errorMessage ? true : undefined}>
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input
                  id="api-key-name"
                  placeholder="My API Key"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                  aria-invalid={errorMessage ? true : undefined}
                />
                <FieldDescription>A memorable name to identify this key.</FieldDescription>
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              <KeyIcon strokeWidth={2} data-icon="inline-start" />
              {isSubmitting ? "Creating..." : "Create key"}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

// ── Key Reveal ───────────────────────────────────────────────────

const KeyRevealContent = ({ apiKey, onClose }: { apiKey: string; onClose: () => void }) => {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async () => {
    await copy(apiKey);
  };

  return (
    <>
      <DialogPanel>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Copy your API key now. You will not be able to see it again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-sm break-all">
              {apiKey}
            </code>
            <Button variant="outline" size="icon" onClick={handleCopy}>
              {copied ? <CheckIcon strokeWidth={2} /> : <CopyIcon strokeWidth={2} />}
            </Button>
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
};

// ── Create Key Dialog (form + reveal) ────────────────────────────

export const CreateApiKeyDialog = ({
  orgId,
  open,
  onOpenChange,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const queryClient = useQueryClient();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  // Lets a late mutation success skip setCreatedKey if the user already closed.
  const openRef = useRef(open);
  openRef.current = open;

  const handleSuccess = async (key: string) => {
    toastManager.add({ title: "API key created", type: "success" });
    if (openRef.current) {
      setCreatedKey(key);
    }
    await queryClient.invalidateQueries({
      queryKey: apiKeysQueryOptions(orgId).queryKey,
    });
  };

  const handleClose = () => {
    setCreatedKey(null);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          setCreatedKey(null);
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{createdKey ? "API key created" : "Create an API key"}</DialogTitle>
          <DialogDescription>
            {createdKey
              ? "Your new API key has been created successfully."
              : "API keys authenticate requests to the management API."}
          </DialogDescription>
        </DialogHeader>
        {createdKey ? (
          <KeyRevealContent apiKey={createdKey} onClose={handleClose} />
        ) : (
          <CreateFormContent orgId={orgId} onSuccess={handleSuccess} />
        )}
      </DialogPopup>
    </Dialog>
  );
};

// ── Revoke Confirmation Dialog ───────────────────────────────────

export const RevokeDialog = ({
  open,
  onOpenChange,
  onConfirm,
  isRevoking,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isRevoking: boolean;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogPopup>
      <DialogHeader>
        <DialogTitle>Revoke API key</DialogTitle>
        <DialogDescription>
          Are you sure you want to revoke this API key? Any applications using this key will lose
          access immediately.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button variant="destructive" disabled={isRevoking} onClick={onConfirm}>
          {isRevoking ? "Revoking..." : "Revoke key"}
        </Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);
