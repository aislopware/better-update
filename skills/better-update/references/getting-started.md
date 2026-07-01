# Getting started: install, auth, config, link

## Requirements

- An Expo project that already uses [`expo-updates`](https://docs.expo.dev/versions/latest/sdk/updates/).
- [Bun](https://bun.sh) ≥ 1.3 to run the CLI (it is Bun-first ESM but also runs on Node ≥ 20).
- A better-update account (default cloud: [updates.jmango360.dev](https://updates.jmango360.dev); or
  a self-hosted server).

## Install

| Style               | Command                                                             | Best for                                        |
| ------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Per-invocation      | `bunx @better-update/cli <command>`                                 | trying things, CI (downloads on demand, caches) |
| Global              | `bun add -g @better-update/cli` then `better-update <command>`      | daily local dev                                 |
| Per-project dev dep | `bun add -d @better-update/cli` then `bunx better-update <command>` | pinning a known-good version                    |
| npx (Node only)     | `npx @better-update/cli <command>`                                  | only if Bun is unavailable (Bun is faster)      |

Verify with `better-update --help` — you should see the top-level command list (`login`, `init`,
`update`, `channels`, …).

A handy pattern for a project is a package.json script:

```json
{
  "scripts": {
    "release:staging": "better-update update publish --branch staging --message \"$MSG\""
  }
}
```

## Point at a server (skip if using the default cloud)

The CLI resolves its server URL in priority order:

| Source                                     | Field        | Notes                                       |
| ------------------------------------------ | ------------ | ------------------------------------------- |
| `BETTER_UPDATE_URL` env var                | API base URL | highest priority; per-shell override        |
| `BETTER_UPDATE_WEB_URL` env var            | Web URL      | used for the `login` browser callback       |
| `~/.better-update/config.json` → `baseUrl` | API base URL | persistent per-user                         |
| `~/.better-update/config.json` → `webUrl`  | Web URL      | persistent per-user                         |
| built-in defaults                          | —            | `https://updates.jmango360.dev` (API + web) |

Persistent config (`~/.better-update/config.json`):

```json
{ "baseUrl": "https://updates.example.com", "webUrl": "https://console.example.com" }
```

One-off (e.g. CI where the URL is a secret):

```bash
BETTER_UPDATE_URL=https://updates.example.com better-update status
```

## Log in

```bash
better-update login
```

Opens `<webUrl>/auth/cli-login` in the default browser, starts a local listener on a random port,
and waits for the callback. The token is saved to `~/.better-update/auth.json` (mode `0600`; the
directory is `0700`).

Headless / remote machine:

```bash
better-update login --api-key      # then paste a session token manually
```

Or skip the file entirely with a robot account (mint one with `credentials robot create`, then grant
it a policy with `credentials robot attach <id> --policy-id managed:admin` — a fresh robot has zero
permissions by default; see `references/credentials.md`), which takes priority over the file:

```bash
BETTER_UPDATE_ROBOT=… better-update update list
```

`better-update logout` deletes `~/.better-update/auth.json`; add `--all` to also clear the cached
Apple Developer session. `better-update whoami` prints the authenticated user/actor and active org.

## Link a project

From the project root:

```bash
better-update init [--id <id>] [--name <name>] [--slug <slug>]
```

`init` links an **Expo or any other** project. With no flags it reads `app.json`, looks up an
existing project by `expo.slug` (creates one if none, using `expo.name`/`expo.slug` for display), and
writes the project id back into the Expo config. `--id` links by an explicit project id (skips the
slug lookup/creation). For **non-Expo** projects, `--name`/`--slug` default to the package.json name
/ kebab-cased name, and the id is written to `eas.json`'s top-level `projectId` instead of `app.json`.

For an Expo project the written config looks like:

```jsonc
{
  "expo": {
    "name": "My App",
    "slug": "my-app",
    "extra": { "betterUpdate": { "projectId": "01J…ULID…" } },
  },
}
```

Every other command reads the project id from there. In a monorepo, run `init` from each app
directory — each `app.json` carries its own `projectId`.

## Wire `expo-updates` (first-time only)

Point the manifest URL at your project, then rebuild the binary **once**; after that updates flow
OTA with no rebuild:

```json
{
  "expo": {
    "updates": {
      "url": "https://updates.jmango360.dev/manifest/<projectId>",
      "enabled": true,
      "checkAutomatically": "ON_LOAD",
      "fallbackToCacheTimeout": 0
    },
    "runtimeVersion": { "policy": "appVersion" }
  }
}
```

The channel a device reads is set at **build time** (build profile / `--release-channel`), not in
`app.json`. Create the channel once (`better-update channels create --name production --branch main`)
and from then on `update publish --branch main` reaches every device on `production`.

## Files the CLI reads/writes

- `~/.better-update/config.json` — `baseUrl` + `webUrl` overrides
- `~/.better-update/auth.json` — saved login token (mode `0600`)
- `./app.json` — `expo.extra.betterUpdate.projectId`

## First update, end to end

```bash
better-update login
better-update init
better-update branches create --name main          # publish target must exist first
better-update update publish --branch main --message "Hello from better-update"
better-update channels create --name production --branch main
```

Then build once with `channel = production` in the build profile. Devices on `production` pull the
new manifest on next launch.

## Diagnostics & dashboard

```bash
better-update status                 # linked project, credential counts, recent builds
better-update doctor                 # check Node>=22, signing tools, server reachability, auth, config (exit 6 on any fail)
better-update open [resource]        # open the dashboard; resource ∈ builds|updates|channels|branches|credentials|devices|env-vars|webhooks|settings
better-update autocomplete <shell>   # print a bash|zsh|fish completion script
```

Run `doctor` first when a command misbehaves — it pinpoints a missing tool, an expired token, or an
unlinked project before you dig further.
