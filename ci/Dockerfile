# Prebuilt CI base image for better-update's GitLab Linux jobs.
# Push to Harbor so CI pulls one fast local image instead of node:22 from Docker
# Hub + reinstalling the toolchain every run.
#
#   docker build -t harbor.jmango360.dev/<project>/better-update-ci:node24 ci
#   docker push  harbor.jmango360.dev/<project>/better-update-ci:node24
#
# Bumping BUN_VERSION / RUST / ZIG_VERSION → rebuild + push a new tag.
#
# IMPORTANT: rust is installed to the DEFAULT ~/.cargo / ~/.rustup (NOT
# CARGO_HOME/RUSTUP_HOME) because `turbo run build` runs in strict env mode and
# strips those vars — a redirected home would be invisible to napi's cargo.
FROM node:24-bookworm

ARG BUN_VERSION=1.3.13
ARG ZIG_VERSION=0.14.1
ARG RUST_TARGETS="x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-unknown-linux-musl aarch64-unknown-linux-musl"

ENV BUN_VERSION=${BUN_VERSION} \
    ZIG_VERSION=${ZIG_VERSION} \
    PATH=/root/.cargo/bin:/root/.bun/bin:/usr/local/zig:$PATH

# System deps: python3 + node-gyp (node-pty has no linux-x64 prebuild → compiles);
# libbz2-dev (bsdiff conformance bspatch.c); jq (release job); clang/lld (cross).
# build-essential (gcc/g++/make), git, curl, xz are already in node:24-bookworm.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ libbz2-dev jq clang lld \
    && npm install -g node-gyp \
    && rm -rf /var/lib/apt/lists/*

# bun (pinned)
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" \
    && bun --version

# rust stable + the Linux cross targets bsdiff builds
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain stable \
    && rustup target add ${RUST_TARGETS} \
    && cargo --version

# zig + cargo-zigbuild (musl cross via `napi build -x`)
RUN curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/zig-x86_64-linux-${ZIG_VERSION}.tar.xz" \
      | tar -xJ -C /usr/local \
    && mv "/usr/local/zig-x86_64-linux-${ZIG_VERSION}" /usr/local/zig \
    && cargo install --locked cargo-zigbuild \
    && zig version && cargo-zigbuild --version
