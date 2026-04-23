import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions, sessionsQueryOptions } from "../../../../queries/auth";
import { AccountConnectedAccountsCard } from "./-account-connected-accounts-card";
import { AccountPasswordCard } from "./-account-password-card";
import { AccountProfileCard } from "./-account-profile-card";
import { AccountSessionsCard } from "./-account-sessions-card";

const AccountPage = () => (
  <div className="flex w-full flex-col gap-4">
    <AccountProfileCard />
    <AccountPasswordCard />
    <AccountConnectedAccountsCard />
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
