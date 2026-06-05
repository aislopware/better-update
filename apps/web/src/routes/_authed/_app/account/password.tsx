import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { SettingCard } from "../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient, rejectOnAuthClientError } from "../../../../lib/auth-client";
import { getFieldError, passwordSchema, requiredStringSchema } from "../../../../lib/form-utils";
import { useApiMutation } from "../../../../lib/use-api-mutation";
import { accountsQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";

const PasswordForm = () => {
  const queryClient = useQueryClient();
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions);
  const hasCredential = accounts.some((account) => account.providerId === "credential");

  const changePasswordMutation = useApiMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) =>
      rejectOnAuthClientError(
        authClient.changePassword({
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        }),
        "Failed to change password",
      ),
    onSuccess: async () => {
      toastManager.add({ title: "Password changed", type: "success" });
      await queryClient.resetQueries({ queryKey: sessionsQueryOptions.queryKey });
    },
  });

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      const [result] = await Promise.allSettled([
        changePasswordMutation.mutateAsync({
          currentPassword: value.currentPassword,
          newPassword: value.newPassword,
        }),
      ]);
      if (result.status === "fulfilled") {
        form.reset();
      }
    },
  });

  if (!hasCredential) {
    return (
      <SettingCard title="Password" description="Set a password to enable email sign-in.">
        <p className="text-muted-foreground text-sm">
          You signed up with a social provider. Add an email & password from{" "}
          <Link
            className="text-foreground underline-offset-2 hover:underline"
            to="/account/connections"
          >
            Connections
          </Link>{" "}
          first.
        </p>
      </SettingCard>
    );
  }

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <SettingCard
        title="Password"
        description="Changing your password will sign you out of other sessions."
        footer={
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit} loading={Boolean(isSubmitting)}>
                Change password
              </Button>
            )}
          </form.Subscribe>
        }
      >
        <div className="grid gap-4">
          <form.Field
            name="currentPassword"
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
                  <FieldLabel htmlFor="current-password">Current password</FieldLabel>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
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
          <form.Field
            name="newPassword"
            validators={{
              onBlur: ({ value }) => {
                const result = passwordSchema.safeParse(value);
                return result.success ? undefined : result.error.issues[0]?.message;
              },
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="new-password">New password</FieldLabel>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
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
          <form.Field
            name="confirmPassword"
            validators={{
              onChangeListenTo: ["newPassword"],
              onChange: ({ value, fieldApi }) =>
                value === fieldApi.form.getFieldValue("newPassword")
                  ? undefined
                  : "Passwords do not match",
            }}
          >
            {(field) => {
              const errorMessage = getFieldError(field);
              return (
                <Field invalid={Boolean(errorMessage)}>
                  <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
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
        </div>
      </SettingCard>
    </form>
  );
};

const PasswordPagePending = () => <SettingCardSkeleton fields={3} />;

export const Route = createFileRoute("/_authed/_app/account/password")({
  beforeLoad: async ({ context }) => {
    await context.queryClient.ensureQueryData(accountsQueryOptions);
  },
  pendingComponent: PasswordPagePending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: PasswordForm,
});
