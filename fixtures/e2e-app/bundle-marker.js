// Overwritten by e2e tests (via `stampBundleMarker`) to force a genuinely
// distinct JS bundle per publish, then restored afterwards.
//
// Assets are content-addressed GLOBALLY on the server (an `assets` row carries
// no project), and every CLI e2e file publishes this one shared fixture. Two
// exports of identical source therefore collapse onto the same asset hash, so
// any test that needs "fresh upload" or "v1 content ≠ v2 content" has to change
// the source itself. The value is rendered by `App.js` so the bundler cannot
// strip it as dead code.
export const BUNDLE_MARKER = "e2e-fixture-default";
