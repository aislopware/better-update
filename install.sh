#!/bin/sh
# Installs the better-update CLI: a single standalone binary (no Node, no Bun).
#
#   curl -fsSL https://raw.githubusercontent.com/aislopware/better-update/main/install.sh | sh
#
# Environment:
#   BETTER_UPDATE_VERSION      version to install (default: latest CLI release)
#   BETTER_UPDATE_INSTALL_DIR  where the binary goes (default: ~/.better-update/bin)
#   BETTER_UPDATE_REPO         GitHub owner/repo to download from
#                              (default: aislopware/better-update; a fork that
#                              ships its own binaries points this at itself)
set -eu

REPO="${BETTER_UPDATE_REPO:-aislopware/better-update}"
INSTALL_DIR="${BETTER_UPDATE_INSTALL_DIR:-$HOME/.better-update/bin}"
TAG_PREFIX="@better-update/cli@"

log() { printf '%s\n' "$*" >&2; }
die() { log "install: $*"; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is required"

# --- target -----------------------------------------------------------------
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS: $os (macOS and Linux only)" ;;
esac
case "$arch" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "unsupported architecture: $arch" ;;
esac
libc=""
if [ "$os" = linux ]; then
  if ls /lib/ld-musl-* >/dev/null 2>&1 || (ldd --version 2>&1 | grep -qi musl); then
    libc="-musl"
  fi
fi
target="$os-$arch$libc"
case "$target" in
  darwin-arm64 | linux-x64 | linux-arm64 | linux-x64-musl | linux-arm64-musl) ;;
  *) die "no prebuilt binary for $target" ;;
esac

# --- version ----------------------------------------------------------------
version="${BETTER_UPDATE_VERSION:-}"
if [ -z "$version" ]; then
  # Releases are listed newest first and mix every package's tags; the first
  # CLI tag is the latest CLI.
  version="$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$REPO/releases?per_page=30" |
    grep -o "\"tag_name\": *\"$TAG_PREFIX[^\"]*\"" | head -n 1 | sed "s/.*$TAG_PREFIX//; s/\"$//")"
  [ -n "$version" ] || die "could not determine the latest release of $REPO"
fi
version="${version#v}"

# --- download ---------------------------------------------------------------
asset="better-update-$target"
base="https://github.com/$REPO/releases/download/$TAG_PREFIX$version"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

log "Downloading better-update $version ($target)…"
curl -fsSL --progress-bar -o "$tmp/$asset" "$base/$asset" ||
  die "download failed: $base/$asset"

if curl -fsSL -o "$tmp/SHA256SUMS" "$base/SHA256SUMS" 2>/dev/null; then
  expected="$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
  else
    actual=""
  fi
  if [ -n "$expected" ] && [ -n "$actual" ] && [ "$expected" != "$actual" ]; then
    die "checksum mismatch for $asset"
  fi
fi

# --- install ----------------------------------------------------------------
mkdir -p "$INSTALL_DIR"
chmod +x "$tmp/$asset"
mv "$tmp/$asset" "$INSTALL_DIR/better-update"
log "Installed better-update $version to $INSTALL_DIR/better-update"

case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    log ""
    log "Add it to your PATH, e.g. in ~/.zshrc or ~/.bashrc:"
    log "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac
