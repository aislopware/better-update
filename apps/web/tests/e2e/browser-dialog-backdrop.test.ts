import type { BrowserContext, Page } from "playwright";

import {
  createSharedBrowserRuntime,
  E2E_DEFAULT_TIMEOUT_MS,
  loginViaUI,
  shortId,
  uniqueEmail,
  waitForOnboarded,
} from "../helpers/browser-helpers";
import { setupE2EDashboard } from "../helpers/e2e-dashboard";
import { seedUserOrgProject } from "../helpers/web-seeder";

// Closing a dialog must fade its backdrop out and keep it out. Base UI gates the
// unmount on the *popup* element's animations only (`useAnimationsFinished` reads
// `popupRef.getAnimations()`), so a backdrop whose own exit animation ends earlier
// stays mounted with nothing holding it at `opacity: 0` — and `animate-out` has
// `animation-fill-mode: none`, which snaps it back to full opacity for the
// remaining frames. That is a visible black flash right before the dialog
// disappears. Guarded here by sampling the backdrop's computed opacity every
// frame from the close interaction until it leaves the DOM.

const dashboard = setupE2EDashboard();
const runtime = createSharedBrowserRuntime();

const suffix = shortId();
const ownerEmail = uniqueEmail("dialog-backdrop");
const projectName = `Backdrop Project ${suffix}`;
const slug = `backdrop-${suffix}`;

let context: BrowserContext;
let page: Page;

interface BackdropTrace {
  readonly samples: readonly number[];
  readonly unmounted: boolean;
}

interface TracingWindow {
  backdropTrace?: Promise<BackdropTrace>;
}

// Kumo puts no identifying attribute on the backdrop, so it is addressed
// structurally: `DialogContent` renders it as the sibling immediately before the
// popup inside the portal, and the popup carries the dialog role.
const backdropSelector = (role: "alertdialog" | "dialog"): string =>
  `[role="presentation"]:has(+ [role="${role}"])`;

/**
 * Installs a per-frame sampler on the on-screen backdrop and parks the resulting
 * promise on `window`. Awaited before the close interaction so no frame of the
 * fade-out is missed to a round-trip.
 */
const startBackdropTrace = async (selector: string): Promise<void> =>
  page.evaluate(async (backdropSelector_: string) => {
    const backdrop = document.querySelector(backdropSelector_);
    if (!backdrop) {
      throw new Error(`no ${backdropSelector_} on screen to trace`);
    }

    // Let the opening fade settle first — otherwise the trace opens on a rising
    // ramp and every assertion below is measuring the wrong animation.
    await Promise.all(backdrop.getAnimations().map(async (animation) => animation.finished)).catch(
      () => undefined,
    );

    (globalThis as unknown as TracingWindow).backdropTrace = new Promise<BackdropTrace>(
      (resolve) => {
        const samples: number[] = [];
        const deadline = performance.now() + 3000;

        const tick = (): void => {
          if (!backdrop.isConnected) {
            resolve({ samples, unmounted: true });
            return;
          }
          samples.push(Number.parseFloat(getComputedStyle(backdrop).opacity));
          if (performance.now() >= deadline) {
            resolve({ samples, unmounted: false });
            return;
          }
          requestAnimationFrame(tick);
        };

        requestAnimationFrame(tick);
      },
    );
  }, selector);

const readBackdropTrace = async (): Promise<BackdropTrace> =>
  page.evaluate(async () => {
    const trace = (globalThis as unknown as TracingWindow).backdropTrace;
    if (!trace) {
      throw new Error("backdrop trace was never started");
    }
    return trace;
  });

/** Asserts the fade-out is one-way: never brighter than the frame before it. */
const expectNoBackdropFlash = (trace: BackdropTrace, label: string): void => {
  const { samples } = trace;
  const report = `${label}: [${samples.map((value) => value.toFixed(2)).join(", ")}]`;

  expect(trace.unmounted, `${label}: backdrop never unmounted — ${report}`).toBe(true);
  // A one-frame trace would satisfy every assertion below without proving anything.
  expect(samples.length, `${label}: too few frames to judge — ${report}`).toBeGreaterThan(2);
  // The trace has to open on a fully drawn backdrop, or it caught the wrong animation.
  expect(samples[0] ?? 0, `${label}: trace did not start fully open — ${report}`).toBeGreaterThan(
    0.9,
  );

  // Rebound check: allow float noise, but nothing resembling a step back up.
  const rebound = samples.findIndex(
    (value, index) => index > 0 && value > (samples[index - 1] ?? 0) + 0.02,
  );
  expect(rebound, `${label}: backdrop brightened mid-close — ${report}`).toBe(-1);

  // And it must be all but gone on the last frame anyone could see it. Base UI
  // `flushSync`-unmounts on the tick the popup's animation finishes, so the final
  // *observable* frame is always one frame short of 0 — at the ~30fps headless
  // Chromium runs at, that bottoms out near 0.05. The bar is set to still catch a
  // snap-back (1.00) or a fade cut off mid-way (~0.85), not to chase that frame.
  expect(
    samples.at(-1) ?? 1,
    `${label}: backdrop still visible at unmount — ${report}`,
  ).toBeLessThan(0.15);
};

beforeAll(async () => {
  await runtime.setup();

  await seedUserOrgProject({
    dashboard,
    name: `Backdrop ${suffix}`,
    email: ownerEmail,
    orgName: `Backdrop Org ${suffix}`,
    orgSlug: `backdrop-${suffix}`,
    projectName,
    slug,
  });

  context = await runtime.getBrowser().newContext();
  page = await context.newPage();
  page.setDefaultTimeout(E2E_DEFAULT_TIMEOUT_MS);
  await loginViaUI(page, dashboard.getBaseUrl(), { email: ownerEmail });
  await waitForOnboarded(page);
});

afterAll(async () => {
  await context.close();
  await runtime.teardown();
});

describe("dialog backdrop fade-out (browser)", () => {
  it("does not flash the command palette backdrop back on when closing", async () => {
    await page.keyboard.press("ControlOrMeta+k");
    const backdrop = page.locator(backdropSelector("dialog"));
    await backdrop.waitFor({ state: "visible" });
    await page.getByPlaceholder("Search pages, projects…").waitFor();

    await startBackdropTrace(backdropSelector("dialog"));
    await page.keyboard.press("Escape");

    expectNoBackdropFlash(await readBackdropTrace(), "command palette");
    await backdrop.waitFor({ state: "detached" });
  });

  it("does not flash a regular dialog backdrop back on when closing", async () => {
    await page.goto(`${dashboard.getBaseUrl()}/projects/${slug}/settings`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const backdrop = page.locator(backdropSelector("dialog"));
    await backdrop.waitFor({ state: "visible" });
    await page.getByRole("heading", { name: `Delete ${projectName}?` }).waitFor();

    await startBackdropTrace(backdropSelector("dialog"));
    await page.keyboard.press("Escape");

    expectNoBackdropFlash(await readBackdropTrace(), "delete project dialog");
    await backdrop.waitFor({ state: "detached" });
  });

  it("does not flash an alert dialog backdrop back on when closing", async () => {
    await page.goto(`${dashboard.getBaseUrl()}/projects/${slug}/settings`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    const backdrop = page.locator(backdropSelector("alertdialog"));
    await backdrop.waitFor({ state: "visible" });
    await page.getByRole("heading", { name: `Archive ${projectName}?` }).waitFor();

    await startBackdropTrace(backdropSelector("alertdialog"));
    // An alert dialog is not dismissible from outside, so close it through its
    // cancel action.
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    expectNoBackdropFlash(await readBackdropTrace(), "archive project alert dialog");
    await backdrop.waitFor({ state: "detached" });
  });
});
