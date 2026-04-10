#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install wasm-pack if not available
if ! command -v wasm-pack &> /dev/null; then
    echo "Installing wasm-pack..."
    cargo install wasm-pack
fi

# Ensure wasm32 target is installed
rustup target add wasm32-unknown-unknown 2>/dev/null || true

# Build WASM module
wasm-pack build \
    --target web \
    --out-dir pkg \
    --release \
    --no-default-features

# Clean up unnecessary files from pkg/
rm -f pkg/.gitignore pkg/package.json pkg/README.md
echo "Build complete. Output in pkg/"
