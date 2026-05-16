import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";

import { SettingCard } from "../../../../components/setting-card";
import { SettingCardSkeleton } from "../../../../components/skeletons";
import { authClient } from "../../../../lib/auth-client";
import { getFieldError, passwordSchema, requiredStringSchema } from "../../../../lib/form-utils";
import { accountsQueryOptions } from "../../../../queries/auth";

const PasswordForm = () => {
  const queryClient = useQueryClient();
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions);
  const hasCredential = accounts.some((account) => account.providerId === "credential");

  const form = useForm({
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.changePassword({
        currentPassword: value.currentPassword,
        newPassword: value.newPassword,
        revokeOtherSessions: true,
      });
      if (error) {
        toastManager.add({ title: error.message ?? "Failed to change password", type: "error" });
        return;
      }
      toastManager.add({ title: "Password changed", type: "success" });
      form.reset();
      await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  if (!hasCredential) {
    return (
      <SettingCard title="Password" description="Set a password to enable email sign-in.">
        <p className="text-muted-foreground text-sm">
          You signed up with a social provider. Add an email & password from{" "}
          <a
            className="text-foreground underline-offset-2 hover:underline"
            href="/account/connections"
          >
            Connections
          </a>{" "}
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
        <FieldGroup>
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
                <Field data-invalid={errorMessage ? true : undefined}>
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
                    aria-invalid={errorMessage ? true : undefined}
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
                <Field data-invalid={errorMessage ? true : undefined}>
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
                    aria-invalid={errorMessage ? true : undefined}
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
                <Field data-invalid={errorMessage ? true : undefined}>
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
                    aria-invalid={errorMessage ? true : undefined}
                  />
                  <FieldError match={Boolean(errorMessage)}>{errorMessage}</FieldError>
                </Field>
              );
            }}
          </form.Field>
        </FieldGroup>
      </SettingCard>
    </form>
  );
};

const PasswordPage = () => (
  <Suspense fallback={<SettingCardSkeleton fields={3} />}>
    <PasswordForm />
  </Suspense>
);

export const Route = createFileRoute("/_authed/_app/account/password")({
  component: PasswordPage,
});
