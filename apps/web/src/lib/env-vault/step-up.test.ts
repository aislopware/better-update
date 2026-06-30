/* @vitest-environment jsdom */
// This suite drives the production step-up code, which persists freshness in
// `sessionStorage`. The `unit` project runs in the Node/Bun runtime (no DOM
// globals), so opt this file into jsdom for a real `sessionStorage`.
import { WEB_ENV_STEP_UP_REQUIRED_MESSAGE, WEB_ENV_STEP_UP_TTL_MS } from "@better-update/api";

import {
  clearStepUp,
  isStepUpFresh,
  isStepUpRequiredError,
  performStepUpGatedWrite,
  runPasskeyStepUp,
} from "./step-up";

// `getTypedApiError` is driven per-test via the shared state so the detection logic
// is exercised without fabricating an Effect FiberFailure. The WebAuthn chain is
// stubbed so `runPasskeyStepUp` only exercises the freshness-marking side effect.
const { apiClientModule, reactModule, webauthnModule, state, mocks } = vi.hoisted(() => ({
  apiClientModule: "@better-update/api-client",
  reactModule: "@better-update/api-client/react",
  webauthnModule: "@simplewebauthn/browser",
  state: { typedError: null as { _tag: string; message: string } | null },
  mocks: {
    stepUpPasskey: vi.fn<() => Promise<{ verifiedAt: string }>>(async () => ({
      verifiedAt: "2026-06-29T00:00:00.000Z",
    })),
    startAuthentication: vi.fn<() => Promise<{ id: string }>>(async () => ({ id: "assertion" })),
  },
}));

vi.mock(apiClientModule, () => ({
  getTypedApiError: () => state.typedError,
}));

vi.mock(reactModule, () => ({
  stepUpPasskey: mocks.stepUpPasskey,
}));

vi.mock(webauthnModule, () => ({
  startAuthentication: mocks.startAuthentication,
}));

describe("env-vault step-up freshness", () => {
  beforeEach(() => {
    globalThis.sessionStorage.clear();
    state.typedError = null;
    mocks.stepUpPasskey.mockClear();
    mocks.startAuthentication.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn<() => Promise<{ ok: boolean; json: () => Promise<{ challenge: string }> }>>(
        async () => ({
          ok: true,
          json: async () => ({ challenge: "challenge-abc" }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("is not fresh before any step-up", () => {
    expect(isStepUpFresh()).toBe(false);
  });

  it("marks the window fresh after a successful step-up and clears it on lock", async () => {
    await runPasskeyStepUp();
    expect(isStepUpFresh()).toBe(true);
    clearStepUp();
    expect(isStepUpFresh()).toBe(false);
  });

  it("treats a step-up older than the TTL as stale", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T00:00:00.000Z"));
    await runPasskeyStepUp();
    expect(isStepUpFresh()).toBe(true);
    vi.setSystemTime(new Date(Date.now() + WEB_ENV_STEP_UP_TTL_MS + 1000));
    expect(isStepUpFresh()).toBe(false);
  });

  it("matches only the shared Forbidden message as step-up-required", () => {
    state.typedError = { _tag: "Forbidden", message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE };
    expect(isStepUpRequiredError(new Error("x"))).toBe(true);

    state.typedError = { _tag: "Forbidden", message: "You lack permission." };
    expect(isStepUpRequiredError(new Error("x"))).toBe(false);

    state.typedError = { _tag: "NotFound", message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE };
    expect(isStepUpRequiredError(new Error("x"))).toBe(false);

    state.typedError = null;
    expect(isStepUpRequiredError(new Error("x"))).toBe(false);
  });

  it("runs a write directly when the step-up is fresh", async () => {
    await runPasskeyStepUp();
    const write = vi.fn<() => Promise<string>>(async () => "written");
    await expect(performStepUpGatedWrite(write)).resolves.toBe("written");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("runs the passkey ceremony before the write when the step-up has lapsed", async () => {
    expect(isStepUpFresh()).toBe(false);
    const order: string[] = [];
    mocks.stepUpPasskey.mockImplementationOnce(async () => {
      order.push("step-up");
      return { verifiedAt: "2026-06-29T00:00:00.000Z" };
    });
    const write = vi.fn<() => Promise<string>>(async () => {
      order.push("write");
      return "written";
    });
    await expect(performStepUpGatedWrite(write)).resolves.toBe("written");
    // The WebAuthn ceremony fires inside the call (before the write), not after a 403.
    expect(order).toStrictEqual(["step-up", "write"]);
    expect(mocks.startAuthentication).toHaveBeenCalledTimes(1);
    expect(isStepUpFresh()).toBe(true);
  });

  it("clears the freshness window when the server rejects a write for a stale step-up", async () => {
    await runPasskeyStepUp();
    expect(isStepUpFresh()).toBe(true);
    state.typedError = { _tag: "Forbidden", message: WEB_ENV_STEP_UP_REQUIRED_MESSAGE };
    const write = vi.fn<() => Promise<never>>(async () => {
      throw new Error("forbidden");
    });
    await expect(performStepUpGatedWrite(write)).rejects.toThrow("forbidden");
    expect(isStepUpFresh()).toBe(false);
  });

  it("keeps the freshness window on an unrelated write error", async () => {
    await runPasskeyStepUp();
    state.typedError = { _tag: "Conflict", message: "Stale vault version." };
    const write = vi.fn<() => Promise<never>>(async () => {
      throw new Error("conflict");
    });
    await expect(performStepUpGatedWrite(write)).rejects.toThrow("conflict");
    expect(isStepUpFresh()).toBe(true);
  });
});
