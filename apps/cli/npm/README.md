# @better-update/cli

The [better-update](https://github.com/aislopware/better-update) command-line
tool: OTA updates, local native builds, the encrypted credential vault, env vars,
channels, rollouts and rollbacks for Expo / React Native / native apps.

This package installs a **standalone binary** — no Node or Bun is needed to run
it. The package manager picks the matching `@better-update/cli-<platform>`
optional dependency (macOS arm64, Linux x64/arm64, glibc or musl) and the
`better-update` launcher execs that binary. Prefer no package manager at all?
The same binaries are on GitHub Releases:

```sh
curl -fsSL https://raw.githubusercontent.com/aislopware/better-update/main/install.sh | sh
```

Documentation: https://github.com/aislopware/better-update/tree/main/skills/better-update
