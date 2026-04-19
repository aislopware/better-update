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
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod/v4";

import { authClient } from "../../lib/auth-client";

const readRedirectTo = (): string =>
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- no redirectTo param means stay on default post-login target
  new URLSearchParams(globalThis.location.search).get("redirectTo") ?? "";

const LoginPage = () => {
  const { queryClient, session, config } = Route.useRouteContext();
  const redirectTo = readRedirectTo();

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.signIn.email({
        email: value.email,
        password: value.password,
      });
      if (error) {
        toast.error(error.message ?? "Failed to sign in");
        return;
      }
      await queryClient.resetQueries({ queryKey: ["auth"] });
      globalThis.location.assign(redirectTo || "/");
    },
  });

  if (session?.user) {
    globalThis.location.replace(redirectTo || "/");
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Enter your credentials to access your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              event.stopPropagation();
              await form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.Field
                name="email"
                validators={{
                  onBlur: ({ value }) => {
                    const result = z.email("Invalid email address").safeParse(value);
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
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(ev) => {
                          field.handleChange(ev.target.value);
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
                    const result = z
                      .string()
                      .check(z.minLength(8, "Password must be at least 8 characters"))
                      .safeParse(value);
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
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input
                        id="password"
                        type="password"
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(ev) => {
                          field.handleChange(ev.target.value);
                        }}
                        aria-invalid={errorMessage ? true : undefined}
                      />
                      <FieldError>{errorMessage}</FieldError>
                    </Field>
                  );
                }}
              </form.Field>

              <form.Subscribe selector={(state) => state.isSubmitting}>
                {(isSubmitting) => (
                  <Button type="submit" disabled={isSubmitting} className="w-full">
                    {isSubmitting ? "Signing in..." : "Sign in"}
                  </Button>
                )}
              </form.Subscribe>
            </FieldGroup>
          </form>

          {config.githubEnabled ? (
            <>
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card text-muted-foreground px-2">Or continue with</span>
                </div>
              </div>

              <Button
                variant="outline"
                className="w-full"
                onClick={async () =>
                  authClient.signIn.social({ provider: "github", callbackURL: redirectTo || "/" })
                }
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
                </svg>
                GitHub
              </Button>
            </>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col gap-2 text-sm">
          <p className="text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="text-primary underline-offset-4 hover:underline">
              Sign up
            </Link>
          </p>
          <Link
            to="/forgot-password"
            className="text-muted-foreground underline-offset-4 hover:underline"
          >
            Forgot your password?
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
};

export const Route = createFileRoute("/(auth)/login")({
  component: LoginPage,
});
