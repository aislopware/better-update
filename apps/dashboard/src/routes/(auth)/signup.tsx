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
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod/v4";

import { authClient } from "../../lib/auth-client";
import { throwRedirect } from "../../lib/throw-redirect";

const nameValidator = z.string().check(z.minLength(2, "Name must be at least 2 characters"));
const emailValidator = z.email("Invalid email address");
const passwordValidator = z
  .string()
  .check(z.minLength(8, "Password must be at least 8 characters"));

const SignupPage = () => {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.signUp.email({
        name: value.name,
        email: value.email,
        password: value.password,
      });
      if (error) {
        toast.error(error.message ?? "Failed to create account");
        return;
      }
      await queryClient.resetQueries({ queryKey: ["auth"] });
      await router.invalidate();
    },
  });

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>Enter your details to get started</CardDescription>
        </CardHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <CardContent>
            <FieldGroup>
              <form.Field
                name="name"
                validators={{
                  onBlur: ({ value }) => {
                    const result = nameValidator.safeParse(value);
                    return result.success ? undefined : result.error.issues[0]?.message;
                  },
                }}
              >
                {(field) => {
                  const errorMessage = field.state.meta.errors
                    .map(String)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                      <Input
                        id={field.name}
                        type="text"
                        placeholder="Your name"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
                        aria-invalid={errorMessage ? true : undefined}
                      />
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field
                name="email"
                validators={{
                  onBlur: ({ value }) => {
                    const result = emailValidator.safeParse(value);
                    return result.success ? undefined : result.error.issues[0]?.message;
                  },
                }}
              >
                {(field) => {
                  const errorMessage = field.state.meta.errors
                    .map(String)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                      <Input
                        id={field.name}
                        type="email"
                        placeholder="you@example.com"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
                        aria-invalid={errorMessage ? true : undefined}
                      />
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <form.Field
                name="password"
                validators={{
                  onBlur: ({ value }) => {
                    const result = passwordValidator.safeParse(value);
                    return result.success ? undefined : result.error.issues[0]?.message;
                  },
                }}
              >
                {(field) => {
                  const errorMessage = field.state.meta.errors
                    .map(String)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                      <Input
                        id={field.name}
                        type="password"
                        placeholder="Min. 8 characters"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
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
                  onChangeListenTo: ["password"],
                  onChange: ({ value, fieldApi }) =>
                    value === fieldApi.form.getFieldValue("password")
                      ? undefined
                      : "Passwords do not match",
                }}
              >
                {(field) => {
                  const errorMessage = field.state.meta.errors
                    .map(String)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <Field data-invalid={errorMessage ? true : undefined}>
                      <FieldLabel htmlFor={field.name}>Confirm password</FieldLabel>
                      <Input
                        id={field.name}
                        type="password"
                        placeholder="Repeat your password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) => {
                          field.handleChange(event.target.value);
                        }}
                        aria-invalid={errorMessage ? true : undefined}
                      />
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex flex-col gap-4 pt-4">
            <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
              {([canSubmit, isSubmitting]) => (
                <Button type="submit" className="w-full" disabled={!canSubmit}>
                  {isSubmitting ? "Creating account..." : "Create account"}
                </Button>
              )}
            </form.Subscribe>
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link to="/login" className="text-primary underline-offset-4 hover:underline">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/signup")({
  beforeLoad: ({ context }) => {
    if (context.session?.user) {
      throwRedirect({ to: "/" });
    }
  },
  component: SignupPage,
});
