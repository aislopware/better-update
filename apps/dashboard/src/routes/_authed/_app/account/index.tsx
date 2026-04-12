import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import { Separator } from "@better-update/ui/components/ui/separator";
import { useForm } from "@tanstack/react-form";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod/v4";

import { authClient } from "../../../../lib/auth-client";
import { nameSchema } from "../../../../lib/form-utils";
import {
  accountsQueryOptions,
  sessionQueryOptions,
  sessionsQueryOptions,
} from "../../../../queries/auth";

const ProfileCard = () => {
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQueryOptions);

  const form = useForm({
    defaultValues: {
      name: session?.user.name ?? "",
    },
    onSubmit: async ({ value }) => {
      const { error } = await authClient.updateUser({ name: value.name });

      if (error) {
        toast.error(error.message ?? "Failed to update profile");
        return;
      }

      toast.success("Profile updated");
      await queryClient.resetQueries({ queryKey: ["auth", "session"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your display name.</CardDescription>
      </CardHeader>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await form.handleSubmit();
        }}
      >
        <CardContent className="flex flex-col gap-4">
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
              const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
              return (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="profile-name">Name</Label>
                  <Input
                    id="profile-name"
                    value={field.state.value}
                    onChange={(event) => {
                      field.handleChange(event.target.value);
                    }}
                    onBlur={field.handleBlur}
                  />
                  {errorMessage ? <p className="text-destructive text-sm">{errorMessage}</p> : null}
                </div>
              );
            }}
          </form.Field>
        </CardContent>
        <CardFooter>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting ? "Saving..." : "Save changes"}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  );
};

const PasswordCard = () => {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Change your account password.</CardDescription>
      </CardHeader>
      {hasCredential ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await form.handleSubmit();
          }}
        >
          <CardContent className="flex flex-col gap-4">
            <form.Field
              name="currentPassword"
              validators={{
                onBlur: ({ value }) => {
                  const result = z
                    .string()
                    .check(z.minLength(1, "Current password is required"))
                    .safeParse(value);
                  return result.success ? undefined : result.error.issues[0]?.message;
                },
              }}
            >
              {(field) => {
                const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
                return (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="current-password">Current password</Label>
                    <Input
                      id="current-password"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                    />
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>

            <form.Field
              name="newPassword"
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
                const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
                return (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="new-password">New password</Label>
                    <Input
                      id="new-password"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                    />
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
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
                const errorMessage = field.state.meta.errors.map(String).filter(Boolean).join(", ");
                return (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="confirm-password">Confirm new password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      value={field.state.value}
                      onChange={(event) => {
                        field.handleChange(event.target.value);
                      }}
                      onBlur={field.handleBlur}
                    />
                    {errorMessage ? (
                      <p className="text-destructive text-sm">{errorMessage}</p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
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
      ) : (
        <CardContent>
          <p className="text-muted-foreground text-sm">
            You signed up with a social provider. Password management is not available.
          </p>
        </CardContent>
      )}
    </Card>
  );
};

const PROVIDER_LABELS: Record<string, string> = {
  credential: "Email & Password",
  github: "GitHub",
};

const ConnectedAccountsCard = () => {
  const queryClient = useQueryClient();
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions);

  const handleUnlink = async (providerId: string) => {
    const { error } = await authClient.unlinkAccount({ providerId });

    if (error) {
      toast.error(error.message ?? "Failed to unlink account");
      return;
    }

    toast.success("Account unlinked");
    await queryClient.resetQueries({ queryKey: ["auth", "accounts"] });
  };

  const handleLinkGithub = async () => {
    await authClient.linkSocial({ provider: "github", callbackURL: "/account" });
  };

  const hasGithub = accounts.some((account) => account.providerId === "github");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connected accounts</CardTitle>
        <CardDescription>Manage your linked sign-in providers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {accounts.map((account) => (
          <div key={account.id} className="flex items-center justify-between">
            <span className="text-sm">
              {PROVIDER_LABELS[account.providerId] ?? account.providerId}
            </span>
            {account.providerId === "credential" ? null : (
              <Button
                variant="outline"
                size="sm"
                disabled={accounts.length <= 1}
                onClick={async () => handleUnlink(account.providerId)}
              >
                Unlink
              </Button>
            )}
          </div>
        ))}
        {hasGithub ? null : (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">GitHub</span>
            <Button variant="outline" size="sm" onClick={handleLinkGithub}>
              Link GitHub
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const SessionsCard = () => {
  const queryClient = useQueryClient();
  const { data: sessions } = useSuspenseQuery(sessionsQueryOptions);
  const { data: currentSession } = useSuspenseQuery(sessionQueryOptions);
  const currentToken = currentSession?.session.token;

  const handleRevoke = async (token: string) => {
    const { error } = await authClient.revokeSession({ token });

    if (error) {
      toast.error(error.message ?? "Failed to revoke session");
      return;
    }

    toast.success("Session revoked");
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  const handleRevokeAll = async () => {
    const { error } = await authClient.revokeOtherSessions();

    if (error) {
      toast.error(error.message ?? "Failed to revoke sessions");
      return;
    }

    toast.success("All other sessions revoked");
    await queryClient.resetQueries({ queryKey: ["auth", "sessions"] });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Manage your active sessions across devices.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sessions.map((session) => {
          const isCurrent = session.token === currentToken;
          return (
            <div key={session.id} className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{session.userAgent ?? "Unknown device"}</span>
                  {isCurrent ? <Badge variant="secondary">Current</Badge> : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {session.ipAddress ?? "Unknown IP"} &middot;{" "}
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              </div>
              {isCurrent ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => handleRevoke(session.token)}
                >
                  Revoke
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Button variant="outline" onClick={handleRevokeAll}>
          Revoke all other sessions
        </Button>
      </CardFooter>
    </Card>
  );
};

const AccountPage = () => (
  <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <div>
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="text-muted-foreground mt-1">
        Manage your profile, password, and connected accounts.
      </p>
    </div>
    <ProfileCard />
    <Separator />
    <PasswordCard />
    <Separator />
    <ConnectedAccountsCard />
    <Separator />
    <SessionsCard />
  </div>
);

export const Route = createFileRoute("/_authed/_app/account/")({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(accountsQueryOptions),
      context.queryClient.ensureQueryData(sessionsQueryOptions),
    ]);
  },
  component: AccountPage,
});
