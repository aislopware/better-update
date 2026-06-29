import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";

import type { ReactNode } from "react";

import { VaultSetupActions } from "./-vault-setup-actions";

// Drive the locked-state machine by controlling the three detection queries. Module
// paths come from hoisted string vars so the partial factories use the loose vi.mock
// overload (a string literal type-checks the factory against the full module). Child
// dialogs are stubbed so we assert which branch renders, not their internals.
const { apiModule, orgModule, routerModule, accountModule, unlockModule, state } = vi.hoisted(
  () => ({
    apiModule: "@better-update/api-client/react",
    orgModule: "../../../../queries/org",
    routerModule: "@tanstack/react-router",
    accountModule: "../account/-account-key-dialogs",
    unlockModule: "./-env-vault-unlock-dialog",
    state: {
      me: { user: { id: "u-1" } } as { user: { id: string } | null } | undefined,
      accountKeys: { items: [] as { id: string; userId: string }[] },
      wraps: { recipients: [] as { recipientKind: string; recipientId: string }[] },
    },
  }),
);

vi.mock(apiModule, () => ({
  accountKeysQueryOptions: (orgId: string) => ({
    queryKey: ["org", orgId, "account-keys"],
    queryFn: async () => state.accountKeys,
  }),
  envVaultWrapsQueryOptions: (orgId: string) => ({
    queryKey: ["org", orgId, "env-vault-wraps"],
    queryFn: async () => state.wraps,
  }),
}));

vi.mock(orgModule, () => ({
  meQueryOptions: () => ({ queryKey: ["me"], queryFn: async () => state.me }),
}));

vi.mock(accountModule, () => ({
  EnrollAccountKeyDialog: () => <div>enroll-account-key-cta</div>,
}));

vi.mock(unlockModule, () => ({
  EnvVaultUnlockDialog: () => <div>unlock-dialog</div>,
}));

vi.mock(routerModule, () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/account/passkeys">{children}</a>,
}));

const renderActions = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VaultSetupActions orgId="org-1" onUnlocked={vi.fn<() => void>()} />
    </QueryClientProvider>,
  );
};

const ACCOUNT_KEY = { id: "ak-1", userId: "u-1" };

describe(VaultSetupActions, () => {
  beforeEach(() => {
    state.me = { user: { id: "u-1" } };
    state.accountKeys = { items: [] };
    state.wraps = { recipients: [] };
  });

  it("offers self-enrollment when the user has no account key", async () => {
    renderActions();
    await waitFor(() => {
      expect(screen.getByText("enroll-account-key-cta")).toBeInTheDocument();
    });
  });

  it("shows the waiting state when enrolled but not yet an env recipient", async () => {
    state.accountKeys = { items: [ACCOUNT_KEY] };
    state.wraps = { recipients: [] };
    renderActions();
    await waitFor(() => {
      expect(
        screen.getByText(/waiting for an admin to grant env-vault access/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("unlock-dialog")).not.toBeInTheDocument();
  });

  it("shows the unlock dialog once the account key holds an env wrap", async () => {
    state.accountKeys = { items: [ACCOUNT_KEY] };
    state.wraps = { recipients: [{ recipientKind: "account", recipientId: "ak-1" }] };
    renderActions();
    await waitFor(() => {
      expect(screen.getByText("unlock-dialog")).toBeInTheDocument();
    });
  });
});
