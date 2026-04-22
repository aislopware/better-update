# better-update

Self-hosted OTA update platform for Expo and React Native apps. Ship JavaScript and asset changes straight to installed devices, manage native builds, and keep full control over the delivery pipeline — without relying on a third-party service.

## Features

### OTA updates

Publish new JavaScript bundles and assets to iOS, Android, or both from a single command. Every release can be shipped to a fraction of users first through staged rollouts, then widened or aborted based on real adoption data. If something breaks, roll back a branch to any previous update or drop users all the way back to the embedded bundle in a single click. Updates can also be promoted between channels without republishing, so a build validated on staging moves to production exactly as it was.

### Branches, channels, and routing

Organise releases around branches (e.g. `main`, `preview`, `release-1.x`) and route devices to them through channels. Channels can be paused, resumed, or repointed at a different branch at any time, giving you a live switchboard between what devices are running and what you've shipped. Each channel keeps its own rollout state, so you can experiment on one channel without touching another.

### Native build pipeline

Trigger iOS (general and ad-hoc) and Android cloud builds directly from the CLI or dashboard, with step-through wizards for the common setups. Upload existing artifacts, generate shareable install links for QA and stakeholders, and manage every credential the pipeline needs — keystores, distribution certificates, push keys, App Store Connect API keys, and Google service account keys — in one place. Apple UDIDs for ad-hoc distribution are registered and invited directly from the organisation settings.

### Compatibility safety

Every native build gets a fingerprint that captures its native module graph, and every OTA update declares which fingerprints it targets. The compatibility matrix shows at a glance which update bundles run on which builds, so you never ship a JS-only update to a binary that can't run it. Fingerprints can also be compared locally to catch native-layer changes before you cut a release.

### Project operations

Manage per-project environment variables with set, get, import, export, and pull workflows that keep local development in sync with what's actually shipping. Audit every action in a searchable log, watch adoption and platform breakdowns in the analytics dashboard, and hand out scoped API keys for CI/CD without sharing user credentials.

### Teams and organisations

Spin up as many organisations as you need — one per client, per product, or per environment — and invite members by email. Each org has its own projects, credentials, audit trail, and settings. Accounts sign in with GitHub OAuth or email and password, link multiple providers, and can revoke any active session from the dashboard.

## License

[PolyForm Noncommercial 1.0.0](./LICENSE.md) — free for personal, research, educational, and nonprofit use. Commercial use requires a separate license.
