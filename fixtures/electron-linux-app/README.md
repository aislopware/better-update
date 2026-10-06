# electron-linux-app

An Electron app for the Linux auto-update journey in
`apps/cli/tests/slow/linux-electron-update.test.ts`: built with electron-builder
(AppImage + deb) inside the Dockerfile's image, uploaded and released with the
CLI, then run so electron-updater updates it from the server's feed.
