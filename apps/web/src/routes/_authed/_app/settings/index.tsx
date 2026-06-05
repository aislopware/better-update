import { updateOrganization } from "@better-update/api-client/react";
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
  DialogTrigger,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { PageHeader } from "../../../../components/page-header";
import { SettingCard } from "../../../../components/setting-card";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../../../lib/form-utils";
import { useDeleteOrgMutation } from "../../../../lib/org-mutations";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { authKeyPrefix, orgsQueryOptions, sessionQueryOptions } from "../../../../queries/auth";

const deleteOrgTrigger = <Button variant="destructive">Delete organization</Button>;

const OrgGeneralForm = () => {
  const queryClient = useQueryClient();
  const { activeOrg } = Route.useRouteContext();
  const slugEdited = useRef(false);

  const updateOrgMutation = useApiMutation({
    mutationFn: async (input: { name: string; slug: string }) => updateOrganization(input),
    onSuccess: async () => {
      toastManager.add({ title: "Organization updated", type: "success" });
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
              <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
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
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="org-name">Organization name</FieldLabel>
                  <Input
                    id="org-name"
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
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
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
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="org-slug">URL slug</FieldLabel>
                  <Input
                    id="org-slug"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                      slugEdited.current = event.target.value !== "";
                    }}
                    onBlur={field.handleBlur}
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
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
      <DialogPanel>
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
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={confirmText !== slug}
          loading={isPending}
          onClick={onConfirm}
        >
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
      toastManager.add({ title: "Organization deleted", type: "success" });
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
      className="border-destructive"
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
          <DialogPopup>
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
          </DialogPopup>
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
    <OrgGeneralForm />
    <DeleteOrgSection />
  </div>
);

export const Route = createFileRoute("/_authed/_app/settings/")({
  component: Settings,
});
