import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EnrollAccountKeyDialog } from "./-account-key-dialogs";

// Stub the browser crypto (so jsdom never runs the real ~128 MiB Argon2id) and the
// register binding. The crypto round-trip itself is covered by
// packages/credentials-crypto/src/account-key.test.ts — here we only assert the
// form logic + the crypto→register field mapping (escrowCt === envelope.ct). Module
// paths come from hoisted string vars so the partial factories use the loose
// vi.mock overload (a string literal would type-check against the full module).
const { cryptoModule, apiModule, cryptoMocks, apiMocks } = vi.hoisted(() => ({
  cryptoModule: "@better-update/credentials-crypto",
  apiModule: "@better-update/api-client/react",
  cryptoMocks: {
    generateAccountKey: vi.fn<() => Promise<unknown>>(),
    sealAccountKey: vi.fn<() => unknown>(),
  },
  apiMocks: {
    registerAccountKey: vi.fn<() => Promise<unknown>>(),
  },
}));

vi.mock(cryptoModule, () => ({
  generateAccountKey: cryptoMocks.generateAccountKey,
  sealAccountKey: cryptoMocks.sealAccountKey,
}));

vi.mock(apiModule, () => ({
  registerAccountKey: apiMocks.registerAccountKey,
  accountKeysQueryKey: (orgId: string) => ["org", orgId, "account-keys"],
}));

const ENVELOPE = {
  version: 1 as const,
  agePublicKey: "age1pubkey",
  ed25519PublicKey: "ed25519-pub-b64",
  fingerprint: "SHA256:fingerprint",
  kdf: "argon2id" as const,
  kdfParams: { time: 3, memory: 131_072, parallelism: 1 },
  salt: "salt-b64",
  cipher: "xchacha20poly1305" as const,
  ct: "escrow-ciphertext-b64",
};

const renderDialog = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <EnrollAccountKeyDialog orgId="org-1" />
    </QueryClientProvider>,
  );
};

const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Set up vault access" }));
  await waitFor(() => {
    expect(screen.getByLabelText("Passphrase")).toBeInTheDocument();
  });
};

describe(EnrollAccountKeyDialog, () => {
  beforeEach(() => {
    cryptoMocks.generateAccountKey.mockReset();
    cryptoMocks.sealAccountKey.mockReset();
    apiMocks.registerAccountKey.mockReset();
    cryptoMocks.generateAccountKey.mockResolvedValue({
      agePrivateKey: "AGE-SECRET-KEY",
      agePublicKey: ENVELOPE.agePublicKey,
      ed25519PrivateKey: "ed25519-priv-b64",
      ed25519PublicKey: ENVELOPE.ed25519PublicKey,
      fingerprint: ENVELOPE.fingerprint,
    });
    cryptoMocks.sealAccountKey.mockReturnValue(ENVELOPE);
    apiMocks.registerAccountKey.mockResolvedValue({
      id: "ak-1",
      fingerprint: ENVELOPE.fingerprint,
    });
  });

  it("rejects mismatched passphrases without registering", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText("Passphrase"), "correct-horse");
    await user.type(screen.getByLabelText("Confirm passphrase"), "different-horse");
    await user.click(screen.getByRole("button", { name: "Enroll account key" }));

    await waitFor(() => {
      expect(screen.getByText("Passphrases do not match")).toBeInTheDocument();
    });
    expect(apiMocks.registerAccountKey).not.toHaveBeenCalled();
  });

  it("rejects a passphrase under 8 characters", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    const passphrase = screen.getByLabelText("Passphrase");
    await user.type(passphrase, "short");
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText("Passphrase must be at least 8 characters")).toBeInTheDocument();
    });
    expect(apiMocks.registerAccountKey).not.toHaveBeenCalled();
  });

  it("seals locally and registers with the envelope mapped to escrowCt", async () => {
    const user = userEvent.setup();
    renderDialog();
    await openDialog(user);

    await user.type(screen.getByLabelText("Passphrase"), "correct-horse-battery");
    await user.type(screen.getByLabelText("Confirm passphrase"), "correct-horse-battery");
    await user.click(screen.getByRole("button", { name: "Enroll account key" }));

    await waitFor(() => {
      expect(apiMocks.registerAccountKey).toHaveBeenCalledTimes(1);
    });
    // The user's passphrase seals the escrow in the browser, never sent to the server.
    expect(cryptoMocks.sealAccountKey).toHaveBeenCalledWith(
      expect.objectContaining({ passphrase: "correct-horse-battery" }),
    );
    expect(apiMocks.registerAccountKey).toHaveBeenCalledWith({
      agePublicKey: ENVELOPE.agePublicKey,
      ed25519PublicKey: ENVELOPE.ed25519PublicKey,
      fingerprint: ENVELOPE.fingerprint,
      kdfParams: ENVELOPE.kdfParams,
      salt: ENVELOPE.salt,
      escrowCt: ENVELOPE.ct,
    });
  });
});
