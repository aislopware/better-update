import {
  isOrganizationLogoContentType,
  removeOrganizationLogo,
  updateOrganization,
  uploadOrganizationLogo,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toast } from "@better-update/ui/components/ui/sonner";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { ChangeEvent } from "react";

import { PageHeader } from "../../../../components/page-header";
import { SettingCard } from "../../../../components/setting-card";
import { assertCapability } from "../../../../lib/access";
import { EntityAvatar } from "../../../../lib/entity-avatar";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../../../lib/form-utils";
import { useDeleteOrgMutation } from "../../../../lib/org-mutations";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { authKeyPrefix, orgsQueryOptions, sessionQueryOptions } from "../../../../queries/auth";

const deleteOrgTrigger = <Button variant="destructive">Delete organization</Button>;

// Mirrors the server-side cap (handlers/logo-helpers.ts MAX_LOGO_BYTES = 2 MiB);
// checked here for instant feedback before the upload round-trip.
const MAX_LOGO_BYTES = 2_097_152;

const OrgLogoSection = () => {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const { activeOrg } = Route.useRouteContext();

  const onSuccess = async (title: string) => {
    toast.success(title);
    await queryClient.resetQueries({ queryKey: authKeyPrefix });
  };

  const uploadMutation = useApiMutation({
    mutationFn: async (file: File) => uploadOrganizationLogo(file),
    onSuccess: async () => onSuccess("Logo updated"),
  });

  const removeMutation = useApiMutation({
    mutationFn: async () => removeOrganizationLogo(),
    onSuccess: async () => onSuccess("Logo removed"),
  });

  const busy = uploadMutation.isPending || removeMutation.isPending;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so re-picking the same file fires onChange again.
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!isOrganizationLogoContentType(file.type)) {
      toast.error("Use a PNG, JPEG, WebP, or SVG image");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be 2 MB or smaller");
      return;
    }
    uploadMutation.mutate(file);
  };

  return (
    <SettingCard
      title="Logo"
      description="Shown across the dashboard. PNG, JPEG, WebP, or SVG up to 2 MB."
      footer={
        <>
          {activeOrg.logo ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                removeMutation.mutate();
              }}
            >
              {removeMutation.isPending && <Spinner data-icon="inline-start" />}
              Remove
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {uploadMutation.isPending && <Spinner data-icon="inline-start" />}
            {activeOrg.logo ? "Replace logo" : "Upload logo"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-4">
        <EntityAvatar
          name={activeOrg.name}
          seed={activeOrg.slug}
          image={activeOrg.logo}
          shape="square"
          className="size-16"
        />
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={handleFileChange}
        />
      </div>
    </SettingCard>
  );
};

const OrgGeneralForm = () => {
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const slugEdited = useRef(false);

  const updateOrgMutation = useApiMutation({
    mutationFn: async (input: { name: string; slug: string }) => updateOrganization(input),
    onSuccess: async () => {
      toast.success("Organization updated");
      await queryClient.resetQueries({ queryKey: authKeyPrefix });
    },
  });

  const form = useForm({
    defaultValues: {
      name: activeOrg.name,
      slug: activeOrg.slug,
    },
    onSubmit: async ({ value }) => {
      await safeSubmit(updateOrgMutation.mutateAsync(value));
    },
  });

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <SettingCard
        title="General"
        description="Update your organization details."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || Boolean(isSubmitting)}>
                {Boolean(isSubmitting) && <Spinner data-icon="inline-start" />}
                Save changes
              </Button>
            )}
          </form.Subscribe>
        }
      >
        <div className="grid gap-4">
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) => {
                const result = nameSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field data-invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
                  <Input
                    id="org-name"
                    aria-invalid={Boolean(errorMessage) || undefined}
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      if (!slugEdited.current) {
                        form.setFieldValue("slug", generateSlug(event.target.value), {
                          dontUpdateMeta: true,
                          dontValidate: true,
                        });
                      }
                    }}
                    onBlur={field.handleBlur}
                  />
                  {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
                </Field>
              );
            }}
          </form.Field>

          <form.Field
            name="slug"
            validators={{
              onBlur: ({ value }) => {
                const result = slugSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field data-invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="org-slug">URL slug</FieldLabel>
                  <Input
                    id="org-slug"
                    aria-invalid={Boolean(errorMessage) || undefined}
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      slugEdited.current = event.target.value !== "";
                    }}
                    onBlur={field.handleBlur}
                  />
                  {errorMessage ? <FieldError>{errorMessage}</FieldError> : null}
                </Field>
              );
            }}
          </form.Field>
        </div>
      </SettingCard>
    </form>
  );
};

const DeleteOrgConfirmForm = ({
  slug,
  isPending,
  onConfirm,
}: {
  slug: string;
  isPending: boolean;
  onConfirm: () => void;
}) => {
  const [confirmText, setConfirmText] = useState("");
  return (
    <>
      <Field>
        <FieldLabel htmlFor="confirm-delete">
          Type <span className="font-mono font-bold">{slug}</span> to confirm
        </FieldLabel>
        <Input
          id="confirm-delete"
          value={confirmText}
          onChange={(event) => {
            setConfirmText(event.target.value);
          }}
          placeholder={slug}
        />
      </Field>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={confirmText !== slug || isPending}
          onClick={onConfirm}
        >
          {isPending && <Spinner data-icon="inline-start" />}
          Delete permanently
        </Button>
      </DialogFooter>
    </>
  );
};

const DeleteOrgSection = () => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const deleteOrgMutation = useDeleteOrgMutation({
    orgId: activeOrg.id,
    onSuccess: async () => {
      toast.success("Organization deleted");
      // Refresh session + orgs before invalidating routes so the guard redirect
      // (e.g. to /onboarding when the last org is gone) reads warm cache instead
      // of suspending mid-transition (router `undefined` throw).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: "all" }),
        queryClient.refetchQueries({ queryKey: orgsQueryOptions.queryKey, type: "all" }),
      ]);
      await router.invalidate();
    },
  });

  return (
    <SettingCard
      destructive
      title="Danger zone"
      description="Permanently delete this organization and all of its data."
      footer={
        <Dialog
          open={open}
          onOpenChange={setOpen}
          onOpenChangeComplete={(next) => {
            if (!next) {
              setResetKey((prev) => prev + 1);
            }
          }}
        >
          <DialogTrigger render={deleteOrgTrigger} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {activeOrg.name}?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. All projects, API keys, and members will be
                permanently removed.
              </DialogDescription>
            </DialogHeader>
            <DeleteOrgConfirmForm
              key={resetKey}
              slug={activeOrg.slug}
              isPending={deleteOrgMutation.isPending}
              onConfirm={() => {
                deleteOrgMutation.mutate();
              }}
            />
          </DialogContent>
        </Dialog>
      }
    />
  );
};

const Settings = () => (
  <div className="flex w-full flex-col gap-6">
    <PageHeader
      title="Organization settings"
      description="Update organization details or permanently delete the organization."
    />
    <OrgLogoSection />
    <OrgGeneralForm />
    <DeleteOrgSection />
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/")({
  beforeLoad: async ({ context }) => {
    await assertCapability(context.queryClient, "canManageOrgSettings");
  },
  component: Settings,
});
