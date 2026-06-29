import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { EnvVar } from "@better-update/api";

import { StepUpGate, useGuardedEnvValue } from "./-step-up-guard";

import type { UnlockedEnvVault } from "../../../../lib/env-vault/use-env-vault";

// The guard is exercised end-to-end with the network read, the step-up freshness
// check, and decryption all stubbed via shared state. Module paths + mock fns are
// hoisted so the partial factories use the loose vi.mock overload and the fns exist
// before the factories run.
const { apiClientModule, reactModule, stepUpModule, revealModule, state, mocks } = vi.hoisted(
  () => ({
    apiClientModule: "@better-update/api-client",
    reactModule: "@better-update/api-client/react",
    stepUpModule: "../../../../lib/env-vault/step-up",
    revealModule: "../../../../lib/env-vault/reveal",
    state: { fresh: false, rejectAsStepUp: false },
    mocks: {
      getEnvVarValue: vi.fn<(id: string) => Promise<unknown>>(),
      runPasskeyStepUp: vi.fn<() => Promise<void>>(),
    },
  }),
);

vi.mock(apiClientModule, () => ({
  getApiError: () => "api-error",
}));

vi.mock(reactModule, () => ({
  getEnvVarValue: mocks.getEnvVarValue,
}));

vi.mock(stepUpModule, () => ({
  isStepUpFresh: () => state.fresh,
  isStepUpRequiredError: () => state.rejectAsStepUp,
  runPasskeyStepUp: mocks.runPasskeyStepUp,
}));

vi.mock(revealModule, () => ({
  revealEnvValue: () => ({ ok: true, value: "decrypted-secret" }),
}));

const ENV_VAR = { id: "ev-1", key: "API_KEY", environment: "production" } as EnvVar;
const VAULT = { vaultKey: new Uint8Array(32), envVaultVersion: 1 } as UnlockedEnvVault;

const Harness = () => {
  const guarded = useGuardedEnvValue({ envVar: ENV_VAR, orgId: "org-1", vault: VAULT });
  if (guarded.kind === "needs-step-up") {
    return (
      <button
        type="button"
        onClick={() => {
          guarded.verify();
        }}
      >
        verify-{String(guarded.verifying)}
      </button>
    );
  }
  if (guarded.kind === "loading") {
    return <div>loading</div>;
  }
  if (guarded.kind === "error") {
    return <div>error:{guarded.message}</div>;
  }
  return <div>value:{guarded.value}</div>;
};

const renderHarness = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
};

describe(useGuardedEnvValue, () => {
  beforeEach(() => {
    state.fresh = false;
    state.rejectAsStepUp = false;
    mocks.getEnvVarValue.mockReset();
    mocks.getEnvVarValue.mockImplementation(async () => {
      if (state.rejectAsStepUp) {
        throw new Error("step-up required");
      }
      return { id: "ev-1", ciphertext: "c", wrappedDek: "w", vaultVersion: 1, vaultKind: "env" };
    });
    mocks.runPasskeyStepUp.mockReset();
    mocks.runPasskeyStepUp.mockImplementation(async () => {
      state.fresh = true;
    });
  });

  it("gates behind a passkey prompt when the step-up is stale, then reveals after verifying", async () => {
    renderHarness();
    expect(screen.getByText("verify-false")).toBeInTheDocument();
    // The gated read does not fire until a step-up looks fresh.
    expect(mocks.getEnvVarValue).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByText("verify-false"));

    await waitFor(() => {
      expect(screen.getByText("value:decrypted-secret")).toBeInTheDocument();
    });
    expect(mocks.runPasskeyStepUp).toHaveBeenCalledTimes(1);
    expect(mocks.getEnvVarValue).toHaveBeenCalledWith("ev-1");
  });

  it("reads immediately when the step-up is already fresh", async () => {
    state.fresh = true;
    renderHarness();
    await waitFor(() => {
      expect(screen.getByText("value:decrypted-secret")).toBeInTheDocument();
    });
    expect(mocks.runPasskeyStepUp).toHaveBeenCalledTimes(0);
  });

  it("drops back to the gate when the server rejects the read for a stale step-up", async () => {
    state.fresh = true;
    state.rejectAsStepUp = true;
    renderHarness();
    await waitFor(() => {
      expect(screen.getByText("verify-false")).toBeInTheDocument();
    });
  });

  it("keeps the loaded value visible when the client freshness window lapses", async () => {
    state.fresh = true;
    const { rerender, queryClient } = renderHarness();
    await waitFor(() => {
      expect(screen.getByText("value:decrypted-secret")).toBeInTheDocument();
    });
    // The client window lapses while the dialog stays open; a re-render must NOT
    // hide an already-loaded value behind the gate (only a server 403 re-gates).
    state.fresh = false;
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>,
    );
    expect(screen.getByText("value:decrypted-secret")).toBeInTheDocument();
    expect(screen.queryByText(/^verify-/)).not.toBeInTheDocument();
  });

  it("re-shows the gate (never a dead-end error) when the read still 403s after verifying", async () => {
    // Stale → gate first; the server keeps rejecting even after the passkey ceremony.
    renderHarness();
    expect(screen.getByText("verify-false")).toBeInTheDocument();
    state.rejectAsStepUp = true;

    fireEvent.click(screen.getByText("verify-false"));

    await waitFor(() => {
      expect(mocks.getEnvVarValue.mock.calls.length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(screen.getByText(/^verify-/)).toBeInTheDocument();
    });
    expect(screen.queryByText("error:api-error")).not.toBeInTheDocument();
  });
});

describe(StepUpGate, () => {
  it("renders the action verb and invokes onVerify on click", () => {
    const onVerify = vi.fn<() => void>();
    render(<StepUpGate action="reveal" verifying={false} onVerify={onVerify} />);
    expect(screen.getByText(/Verify again to reveal this value/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Verify with passkey/ }));
    expect(onVerify).toHaveBeenCalledTimes(1);
  });
});
