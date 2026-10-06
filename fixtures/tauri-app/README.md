# Tauri updater fixture

A minimal Tauri v2 app with the updater plugin, for
`apps/cli/tests/slow/tauri-update.test.ts`. Started with `FIXTURE_UPDATE_ENDPOINT`
and `FIXTURE_RESULT_FILE`, it checks that endpoint, installs the update it offers,
writes `<current version> installed <new version>` (or `none` / `error: …`) and
quits.

`plugins.updater.pubkey` belongs to the throwaway test key `updater-test.key`
(password `test-pass`), also the vector in `apps/cli/src/lib/tauri-signature.test.ts`.
`dangerousInsecureTransportProtocol` is on only because the test server is plain
http on localhost; `requireSignedVersion` makes the updater insist that the
signature names the version the feed announces.
