import { createApiKey } from "@better-update/api-client/react";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { KeyIcon, CopyIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

import { getFieldError, requiredStringSchema } from "../../../lib/form-utils";
import { useApiMutation, safeSubmit } from "../../../lib/use-api-mutation";
import { useCopyToClipboard } from "../../../lib/use-copy-to-clipboard";
import { apiKeysQueryOptions } from "../../../queries/api-keys";

// ── Key Reveal ───────────────────────────────────────────────────

const KeyRevealContent = ({ apiKey, onClose }: { apiKey: string; onClose: () => void }) => {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async () => {
    await copy(apiKey);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>API key created</DialogTitle>
        <DialogDescription>Your new API key has been created successfully.</DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">
            Copy your API key now. You will not be able to see it again.
          </p>
          <InputGroup>
            <InputGroupInput readOnly value={apiKey} className="font-mono text-sm" />
            <InputGroupAddon align="inline-end">
              <Button variant="ghost" size="icon-xs" aria-label="Copy API key" onClick={handleCopy}>
                {copied ? <CheckIcon strokeWidth={2} /> : <CopyIcon strokeWidth={2} />}
              </Button>
            </InputGroupAddon>
          </InputGroup>
          <p className="text-muted-foreground text-sm">
            This key has no permissions yet. Open its menu and choose{" "}
            <span className="font-medium">Manage policies</span> to grant access.
          </p>
        </div>
      </DialogPanel>
      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </>
  );
};

// ── Create Form ──────────────────────────────────────────────────

const CreateFormContent = ({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: (key: string) => void;
}) => {
  const queryClient = useQueryClient();

  const createMutation = useApiMutation({
    mutationFn: async (name: string) => createApiKey({ name }),
    onSuccess: async (result) => {
      toastManager.add({ title: "API key created", type: "success" });
      await queryClient.invalidateQueries({
        queryKey: apiKeysQueryOptions(orgId).queryKey,
      });
      onCreated(result.key);
    },
  });

  const form = useForm({
    defaultValues: { name: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(createMutation.mutateAsync(value.name));
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
              <Field invalid={Boolean(errorMessage)}>
                <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
                <Input
                  id="api-key-name"
                  placeholder="My API Key"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldDescription>A memorable name to identify this key.</FieldDescription>
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
      </DialogPanel>

      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
              <KeyIcon strokeWidth={2} data-icon="inline-start" />
              Create key
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

// ── Inner content holding form ↔ reveal swap ──────────────────────

const CreateApiKeyContent = ({ orgId, onClose }: { orgId: string; onClose: () => void }) => {
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  if (createdKey) {
    return <KeyRevealContent apiKey={createdKey} onClose={onClose} />;
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Create an API key</DialogTitle>
        <DialogDescription>API keys authenticate requests to the management API.</DialogDescription>
      </DialogHeader>
      <CreateFormContent orgId={orgId} onCreated={setCreatedKey} />
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
  const [resetKey, setResetKey] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(next) => {
        if (!next) {
          setResetKey((prev) => prev + 1);
        }
      }}
    >
      <DialogPopup>
        <CreateApiKeyContent
          key={resetKey}
          orgId={orgId}
          onClose={() => {
            onOpenChange(false);
          }}
        />
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
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button variant="destructive" loading={isRevoking} onClick={onConfirm}>
          Revoke key
        </Button>
      </DialogFooter>
    </DialogPopup>
  </Dialog>
);
