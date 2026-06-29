import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VaultAccessGrant } from "./-vault-access-grant";

// Inject the unlocked-vault controller + stub the crypto/grant bindings so we can
// assert the grant wiring: the unlocked env-vault key is wrapped to the target's
// PUBLIC age recipient and submitted as an `account` env wrap. Module paths come
// from hoisted string vars so the partial factories use the loose vi.mock overload.
const { cryptoModule, encodingModule, apiModule, vaultModule, unlockModule, state, fns } =
  vi.hoisted(() => ({
    cryptoModule: "@better-update/credentials-crypto",
    encodingModule: "@better-update/encoding",
    apiModule: "@better-update/api-client/react",
    vaultModule: "../../../lib/env-vault/use-env-vault",
    unlockModule: "./environment-variables/-env-vault-unlock-dialog",
    state: {
      enabled: true,
      unlocked: { vaultKey: new Uint8Array([9, 9, 9]), envVaultVersion: 3 } as {
        vaultKey: Uint8Array;
        envVaultVersion: number;
      } | null,
      accountKeys: {
        items: [] as { id: string; agePublicKey: string; fingerprint: string; createdAt: string }[],
      },
      wraps: { recipients: [] as { recipientKind: string; recipientId: string }[] },
    },
    fns: {
      addEnvWrap: vi.fn<() => Promise<unknown>>(),
      wrapVaultKey: vi.fn<() => Promise<Uint8Array>>(),
      toBase64: vi.fn<() => string>(),
    },
  }));

vi.mock(cryptoModule, () => ({ wrapVaultKey: fns.wrapVaultKey }));
vi.mock(encodingModule, () => ({ toBase64: fns.toBase64 }));
vi.mock(apiModule, () => ({
  addEnvWrap: fns.addEnvWrap,
  accountKeysQueryOptions: (orgId: string) => ({
    queryKey: ["org", orgId, "account-keys"],
    queryFn: async () => state.accountKeys,
  }),
  envVaultWrapsQueryOptions: (orgId: string) => ({
    queryKey: ["org", orgId, "env-vault-wraps"],
    queryFn: async () => state.wraps,
  }),
  accountKeysQueryKey: (orgId: string) => ["org", orgId, "account-keys"],
  envVaultWrapsQueryKey: (orgId: string) => ["org", orgId, "env-vault-wraps"],
}));
vi.mock(vaultModule, () => ({
  useEnvVault: () => ({
    enabled: state.enabled,
    unlocked: state.unlocked,
    onUnlocked: vi.fn<() => void>(),
    lock: vi.fn<() => void>(),
  }),
}));
vi.mock(unlockModule, () => ({
  EnvVaultUnlockDialog: () => <div>unlock-dialog</div>,
}));

const renderGrant = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VaultAccessGrant orgId="org-1" />
    </QueryClientProvider>,
  );
};

describe(VaultAccessGrant, () => {
  beforeEach(() => {
    state.enabled = true;
    state.unlocked = { vaultKey: new Uint8Array([9, 9, 9]), envVaultVersion: 3 };
    state.accountKeys = { items: [] };
    state.wraps = { recipients: [] };
    fns.addEnvWrap.mockReset();
    fns.wrapVaultKey.mockReset();
    fns.toBase64.mockReset();
    fns.addEnvWrap.mockResolvedValue({});
    fns.wrapVaultKey.mockResolvedValue(new Uint8Array([1, 2, 3]));
    fns.toBase64.mockReturnValue("wrapped-key-b64");
  });

  it("renders nothing off the vault origin", () => {
    state.enabled = false;
    renderGrant();
    expect(screen.queryByText("Env-vault access")).not.toBeInTheDocument();
  });

  it("prompts to unlock when the admin has not unlocked the env vault", () => {
    state.unlocked = null;
    renderGrant();
    expect(screen.getByText("unlock-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Unlock the env vault to grant/)).toBeInTheDocument();
  });

  it("grants by wrapping the env key to the target's public recipient", async () => {
    state.accountKeys = {
      items: [
        {
          id: "ak-1",
          agePublicKey: "age1target",
          fingerprint: "SHA256:fp",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    state.wraps = { recipients: [] };
    const user = userEvent.setup();
    renderGrant();

    await user.click(await screen.findByRole("button", { name: "Grant env access" }));

    await waitFor(() => {
      expect(fns.wrapVaultKey).toHaveBeenCalledWith({
        vaultKey: state.unlocked?.vaultKey,
        recipient: "age1target",
      });
    });
    expect(fns.addEnvWrap).toHaveBeenCalledWith({
      envVaultVersion: 3,
      wrap: { recipientKind: "account", recipientId: "ak-1", wrappedKey: "wrapped-key-b64" },
    });
  });

  it("hides an account key that already holds an env wrap", async () => {
    state.accountKeys = {
      items: [
        {
          id: "ak-1",
          agePublicKey: "age1target",
          fingerprint: "SHA256:fp",
          createdAt: "2026-06-01T00:00:00Z",
        },
      ],
    };
    state.wraps = { recipients: [{ recipientKind: "account", recipientId: "ak-1" }] };
    renderGrant();

    await waitFor(() => {
      expect(
        screen.getByText(/Every enrolled member already has env-vault access/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Grant env access" })).not.toBeInTheDocument();
  });
});
