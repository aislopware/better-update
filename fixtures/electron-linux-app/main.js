// Starts, records its version, and — with CHECK_UPDATES=1 — asks the feed at
// FEED_URL for an update, downloads it and installs it the way a user's app
// does (`quitAndInstall`). Everything it sees goes to UPDATE_LOG.
const { appendFileSync } = require("node:fs");

const { app } = require("electron");
const { autoUpdater } = require("electron-updater");

const log = (line) => appendFileSync(process.env.UPDATE_LOG, `${line}\n`);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  log(`version ${app.getVersion()}`);
  if (process.env.CHECK_UPDATES !== "1") {
    app.quit();
    return;
  }
  autoUpdater.logger = {
    info: (message) => log(`info ${message}`),
    warn: (message) => log(`warn ${message}`),
    error: (message) => log(`error ${message}`),
    debug: () => {},
  };
  autoUpdater.setFeedURL({ provider: "generic", url: process.env.FEED_URL });
  autoUpdater.on("update-not-available", () => {
    log("update-not-available");
    app.quit();
  });
  autoUpdater.on("error", (error) => {
    log(`update-error ${error.stack ?? error}`);
    app.exit(1);
  });
  autoUpdater.on("update-downloaded", (info) => {
    log(`update-downloaded ${info.version}`);
    autoUpdater.quitAndInstall(true, false);
  });
  // null: the updater is inactive here (an AppImage started without APPIMAGE).
  if ((await autoUpdater.checkForUpdates()) === null) {
    log("updater-inactive");
    app.exit(1);
  }
});
