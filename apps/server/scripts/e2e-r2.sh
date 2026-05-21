#!/usr/bin/env bash
# Launch the `e2e-pool-r2` vitest project with real Cloudflare creds for the
# wrangler remote R2 proxy.
#
# The direct-upload e2e file runs on @cloudflare/vitest-pool-workers with its R2
# binding `remote: true`, so wrangler opens a remote proxy session to the real
# `*-e2e` bucket. That proxy is a child process; it reads CLOUDFLARE_ACCOUNT_ID +
# CLOUDFLARE_API_TOKEN from the environment it inherits at spawn time, so a
# mid-config process.env mutation is too late. Map them from .env.local's E2E_*
# values before vitest starts. Values already in the environment (e.g. from CI)
# take precedence.
set -eu
cd "$(dirname "$0")/.."

read_env() {
  grep -E "^$1=" .env.local 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

if [ -f .env.local ]; then
  : "${CLOUDFLARE_ACCOUNT_ID:=$(read_env E2E_CF_ACCOUNT_ID)}"
  : "${CLOUDFLARE_API_TOKEN:=$(read_env E2E_CLOUDFLARE_API_TOKEN)}"
  export CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "Missing Cloudflare creds for the remote R2 proxy. Set E2E_CF_ACCOUNT_ID +" \
    "E2E_CLOUDFLARE_API_TOKEN in apps/server/.env.local (or CLOUDFLARE_* in the environment)." >&2
  exit 1
fi

# A single direct-upload file → one remote-proxy session, so no per-file process
# splitting is needed. Extra args pass through as a test-name/file filter.
exec vitest run --project e2e-pool-r2 "$@"
