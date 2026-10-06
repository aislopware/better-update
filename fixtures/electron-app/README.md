# electron-app

An Electron app for the auto-update journeys: built with electron-builder,
uploaded and released with the CLI, then run so electron-updater updates it
from the server's feed.

- macOS (`apps/cli/tests/slow/electron-macos-update.test.ts`): `build --platform
macos` signs it with the vault's Developer ID identity; Squirrel.Mac installs
  the update.
- Linux (`apps/cli/tests/slow/linux-electron-update.test.ts`): built as an
  AppImage and a deb inside the Dockerfile's image.
