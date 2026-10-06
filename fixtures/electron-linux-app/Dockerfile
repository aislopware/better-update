# Builds and runs the Electron fixture on Linux: electron-builder makes the
# AppImage and deb, Xvfb gives Electron a display, dpkg installs the deb, and
# socat forwards the test server's loopback port to the Docker host.
FROM node:22-bookworm
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb xauth libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6 libnotify4 \
      libsecret-1-0 libatspi2.0-0 libdrm2 libxkbcommon0 libuuid1 xdg-utils socat \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.4.2"
WORKDIR /app
