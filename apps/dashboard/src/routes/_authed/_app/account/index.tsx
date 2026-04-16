import { Separator } from "@better-update/ui/components/ui/separator";
import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";
import { AccountConnectedAccountsCard } from "./-account-connected-accounts-card";
import { AccountPasswordCard } from "./-account-password-card";
import { AccountProfileCard } from "./-account-profile-card";
import { AccountSessionsCard } from "./-account-sessions-card";

const AccountPage = () => (
  <div className="mx-auto flex max-w-2xl flex-col gap-6">
    <div>
      <h1 className="text-2xl font-bold">Account</h1>
      <p className="text-muted-foreground mt-1">
        Manage your profile, password, and connected accounts.
      </p>
    </div>
    <AccountProfileCard />
    <Separator />
    <AccountPasswordCard />
    <Separator />
    <AccountConnectedAccountsCard />
    <Separator />
    <AccountSessionsCard />
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
