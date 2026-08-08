import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/dialog";
import { Field } from "@better-update/ui/components/field";
import { FieldGroup } from "@better-update/ui/components/field-layout";
import { Input } from "@better-update/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { SlugInput } from "../../components/slug-input";
import { generateSlug, getFieldError, nameSchema, slugSchema } from "../../lib/form-utils";
import { useCreateAndActivateOrgMutation } from "../../lib/org-mutations";
import { SITE } from "../../lib/site-config";
import { safeSubmit } from "../../lib/use-api-mutation";
import { orgsQueryOptions, sessionQueryOptions } from "../../queries/auth";

const CreateOrgForm = ({ onSuccess }: { onSuccess: () => void }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const slugEdited = useRef(false);

  const createOrg = useCreateAndActivateOrgMutation({
    onSuccess: async () => {
      // Prime session + orgs before navigating so the redirect chain reads warm
      // cache instead of suspending mid-transition (router `undefined` throw).
      await Promise.all([
        queryClient.refetchQueries({ queryKey: sessionQueryOptions.queryKey, type: "all" }),
        queryClient.refetchQueries({ queryKey: orgsQueryOptions.queryKey, type: "all" }),
      ]);
      onSuccess();
      await router.navigate({ to: "/" });
    },
  });

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      await safeSubmit(createOrg.mutateAsync(value));
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
      <FieldGroup>
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
              <Input
                label="Organization name"
                error={errorMessage}
                id="create-org-name"
                placeholder="Acme Inc."
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
              <Field
                label="Organization URL"
                description="Lowercase letters, numbers and dashes only."
                error={errorMessage}
              >
                <SlugInput
                  addonStart={`${SITE.host}/`}
                  id="create-org-slug"
                  aria-label="Organization URL"
                  placeholder="acme-inc"
                  aria-invalid={Boolean(errorMessage) || undefined}
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                    slugEdited.current = event.target.value !== "";
                  }}
                  onBlur={field.handleBlur}
                />
              </Field>
            );
          }}
        </form.Field>
      </FieldGroup>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>Cancel</DialogClose>
        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
          {([canSubmit, isSubmitting]) => (
            <Button
              variant="primary"
              type="submit"
              disabled={!canSubmit || Boolean(isSubmitting)}
              loading={Boolean(isSubmitting)}
            >
              Create organization
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  );
};

export const CreateOrgDialog = ({
  open,
  onOpenChange,
}: {
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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Where a team shares its projects, credentials, and API keys.
          </DialogDescription>
        </DialogHeader>
        <CreateOrgForm
          key={resetKey}
          onSuccess={() => {
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};
