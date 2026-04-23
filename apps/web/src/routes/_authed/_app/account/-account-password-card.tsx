import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { authClient } from "../../../../lib/auth-client";
import { getFieldError, passwordSchema, requiredStringSchema } from "../../../../lib/form-utils";
import { accountsQueryOptions } from "../../../../queries/auth";

export const AccountPasswordCard = () => {
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
        toast.error(error.message ?? "Failed to change password");
        return;
      }

      toast.success("Password changed");
      form.reset();
      await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
    },
  });

  if (!hasCredential) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Change your account password.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            You signed up with a social provider. Password management is not available.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change your account password.</CardDescription>
      </CardHeader>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await form.handleSubmit();
        }}
      >
        <CardContent>
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
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={errorMessage ? true : undefined}
                    />
                    <FieldError>{errorMessage}</FieldError>
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
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={errorMessage ? true : undefined}
                    />
                    <FieldError>{errorMessage}</FieldError>
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
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                      aria-invalid={errorMessage ? true : undefined}
                    />
                    <FieldError>{errorMessage}</FieldError>
                  </Field>
                );
              }}
            </form.Field>
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Changing..." : "Change password"}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
};
