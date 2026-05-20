import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { SettingCard } from "../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { getFieldError, nameSchema } from "../../../../lib/form-utils";
import { safeSubmit, useApiMutation } from "../../../../lib/use-api-mutation";
import { sessionQueryOptions } from "../../../../queries/auth";

const ProfileForm = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);

  const updateProfileMutation = useApiMutation({
    mutationFn: async (input: { name: string }) =>
      rejectOnAuthClientError(authClient.updateUser(input), "Failed to update profile"),
    onSuccess: async () => {
      toastManager.add({ title: "Profile updated", type: "success" });
      await queryClient.resetQueries({ queryKey: sessionQueryOptions.queryKey });
    },
  });

  const form = useForm({
    defaultValues: {
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- controlled input requires string
      name: session?.user.name ?? "",
    },
    onSubmit: async ({ value }) => {
      await safeSubmit(updateProfileMutation.mutateAsync(value));
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
        title="Profile"
        description="This is how others will see you across the workspace."
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
                <FieldLabel htmlFor="profile-name">Name</FieldLabel>
                <Input
                  id="profile-name"
                  value={field.state.value}
                  onChange={(event) => {
                    field.handleChange(event.target.value);
                  }}
                  onBlur={field.handleBlur}
                />
                <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
              </Field>
            );
          }}
        </form.Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input
            // eslint-disable-next-line eslint-js/no-restricted-syntax -- session.user is non-null on /account/* routes; controlled input requires string
            value={session?.user.email ?? ""}
            disabled
          />
          <p className="text-muted-foreground text-xs">
            Tied to your sign-in identity. Contact support to change it.
          </p>
        </Field>
      </SettingCard>
    </form>
  );
};

const ProfilePagePending = () => <SettingCardSkeleton fields={2} />;

export const Route = createFileRoute("/_authed/_app/account/profile")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(sessionQueryOptions);
  },
  pendingComponent: ProfilePagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: ProfileForm,
});
