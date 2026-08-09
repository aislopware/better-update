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
// `popupRef.getAnimations()`), so a backdrop whose own exit ends earlier stays
// mounted for a few frames with nothing holding it down. Under the pre-Kumo
// markup those frames snapped back to full opacity — `animate-out` leaves
// `animation-fill-mode` at `none` — and read as solid black right before the
// dialog disappeared. Kumo drives the same fade with a transition rather than a
// keyframe animation, which does not have that failure mode, but the property
// being guarded is the user-visible one either way: sample the backdrop's
// computed opacity every frame from the close interaction until it leaves the
// DOM, and reject any rebound.

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
// structurally. Inside the portal, a modal dialog lays out as
//
//   <div role="presentation" data-base-ui-inert>   ← Base UI `InternalBackdrop`
//   <div role="presentation" class="fixed …">      ← Kumo's painted backdrop
//   <span data-floating-ui-focus-guard>            ← `FloatingFocusManager`
//   <div role="dialog">                            ← the popup
//   <span data-floating-ui-focus-guard>
//
// which is why the combinator is the *general* sibling one (a focus guard sits
// between the backdrop and the popup, so `+` matches nothing) and why the
// selector resolves to two elements. `InternalBackdrop` is `DialogPortal`'s
// first child and Kumo's is the first of `props.children`, so the painted one
// is always the last match.
const backdropSelector = (role: "alertdialog" | "dialog"): string =>
  `[role="presentation"]:has(~ [role="${role}"])`;

const backdropLocator = (role: "alertdialog" | "dialog") =>
  page.locator(backdropSelector(role)).last();

/**
 * Installs a per-frame sampler on the on-screen backdrop and parks the resulting
 * promise on `window`. Awaited before the close interaction so no frame of the
 * fade-out is missed to a round-trip.
 *
 * Returns the backdrop's resting opacity, which is the caller's yardstick for
 * the trace. It is read here rather than by the caller because the enter fade
 * has to have settled first, and this is the one place that waits for it —
 * Playwright counts a fully transparent element as visible, so a reading taken
 * off the locator the moment it appears is 0.
 */
const startBackdropTrace = async (selector: string): Promise<number> =>
  page.evaluate(async (backdropSelector_: string) => {
    // `.at(-1)`, matching `backdropLocator`: the first match is Base UI's
    // unpainted `InternalBackdrop`, whose opacity says nothing about the flash.
    const backdrop = [...document.querySelectorAll(backdropSelector_)].at(-1);
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

    return Number.parseFloat(getComputedStyle(backdrop).opacity);
  }, selector);

const readBackdropTrace = async (): Promise<BackdropTrace> =>
  page.evaluate(async () => {
    const trace = (globalThis as unknown as TracingWindow).backdropTrace;
    if (!trace) {
      throw new Error("backdrop trace was never started");
    }
    return trace;
  });

/**
 * Asserts the fade-out is one-way: never brighter than the frame before it.
 *
 * `restingOpacity` is read off the backdrop while the dialog is open, rather
 * than assumed: Kumo rests its backdrop at `opacity-80`, and pinning the number
 * here would make the suite fail the next time that shade is retuned.
 */
const expectNoBackdropFlash = (
  trace: BackdropTrace,
  label: string,
  restingOpacity: number,
): void => {
  const { samples } = trace;
  const report = `${label}: [${samples.map((value) => value.toFixed(2)).join(", ")}]`;

  expect(trace.unmounted, `${label}: backdrop never unmounted — ${report}`).toBe(true);
  // A one-frame trace would satisfy every assertion below without proving anything.
  expect(samples.length, `${label}: too few frames to judge — ${report}`).toBeGreaterThan(2);
  // A painted backdrop, not Base UI's transparent `InternalBackdrop`.
  expect(restingOpacity, `${label}: backdrop is not painted — ${report}`).toBeGreaterThan(0.1);
  // The trace has to open on a fully drawn backdrop, or it caught the wrong animation.
  expect(
    samples[0] ?? 0,
    `${label}: trace did not start at rest (${restingOpacity.toFixed(2)}) — ${report}`,
  ).toBeGreaterThan(restingOpacity - 0.02);

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
    // The dialog's own content first: a structural backdrop lookup that finds
    // nothing cannot say whether the markup moved or the dialog never opened.
    await page.getByPlaceholder("Search pages, projects…").waitFor();
    const backdrop = backdropLocator("dialog");
    await backdrop.waitFor({ state: "visible" });

    const resting = await startBackdropTrace(backdropSelector("dialog"));
    await page.keyboard.press("Escape");

    expectNoBackdropFlash(await readBackdropTrace(), "command palette", resting);
    await backdrop.waitFor({ state: "detached" });
  });

  // The project settings confirmations are both `role="alertdialog"` (a click
  // outside must not throw away a destructive answer), so the plain-dialog case
  // is taken from the projects list instead.
  it("does not flash a regular dialog backdrop back on when closing", async () => {
    await page.goto(`${dashboard.getBaseUrl()}/projects`);
    await page.getByRole("button", { name: "Create project" }).click();

    await page.getByRole("heading", { name: "Create a project" }).waitFor();
    const backdrop = backdropLocator("dialog");
    await backdrop.waitFor({ state: "visible" });

    const resting = await startBackdropTrace(backdropSelector("dialog"));
    await page.keyboard.press("Escape");

    expectNoBackdropFlash(await readBackdropTrace(), "create project dialog", resting);
    await backdrop.waitFor({ state: "detached" });
  });

  it("does not flash an alert dialog backdrop back on when closing", async () => {
    await page.goto(`${dashboard.getBaseUrl()}/projects/${slug}/settings`);
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    await page.getByRole("heading", { name: `Archive ${projectName}?` }).waitFor();
    const backdrop = backdropLocator("alertdialog");
    await backdrop.waitFor({ state: "visible" });

    const resting = await startBackdropTrace(backdropSelector("alertdialog"));
    // An alert dialog is not dismissible from outside, so close it through its
    // cancel action.
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();

    expectNoBackdropFlash(await readBackdropTrace(), "archive project alert dialog", resting);
    await backdrop.waitFor({ state: "detached" });
  });
});
