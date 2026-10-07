import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { setupCliE2E } from "../helpers/cli-e2e";

/**
 * A project's deb releases installed and upgraded by real apt from the
 * server's APT repository: Ubuntu 24.04 (apt 2.7, gpgv verifies `InRelease`)
 * and Debian 13 (apt 3.0, Sequoia's sqv verifies it). Each machine fetches
 * the signing key, adds the `sources.list` line the CLI prints, and runs
 * `apt-get update` / `install` / `upgrade` against the local server; a
 * release below 100 % is held back by apt's phased updates until it is
 * rolled out, and a halted one leaves the index.
 *
 * Gated on a running Docker daemon. The debs are built with `dpkg-deb` in
 * the Ubuntu image for its own architecture:
 *
 *   bun run test:slow -- tests/slow/apt-repository.test.ts
 *
 * apt's output for each step is kept in `$TMPDIR/better-update-e2e/apt-repository/`.
 */
const hasDocker = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

const PACKAGE = "example-apt";
const VERSIONS = ["1.0.0", "1.1.0", "1.2.0"] as const;
const EVIDENCE_DIR = path.join(os.tmpdir(), "better-update-e2e", "apt-repository");
/** A fixed machine id, so apt's phasing puts this machine in the same bucket every run. */
const MACHINE_ID = "0123456789abcdef0123456789abcdef";

const DISTROS = {
  ubuntu: { image: "ubuntu:24.04", tag: "better-update-e2e/apt-ubuntu:24.04" },
  debian: { image: "debian:trixie", tag: "better-update-e2e/apt-debian:trixie" },
} as const;
type Distro = keyof typeof DISTROS;

const cli = setupCliE2E("slow-cli-apt-repository", {
  noExpoConfig: true,
  appJsonTemplate: { expo: { name: "APT E2E", slug: "apt-e2e" } },
  userEmail: "slow-cli-apt-repository@example.com",
  orgSlug: "slow-cli-apt-repository-org",
});

const expectSuccess = (result: {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}) => {
  expect(
    result.exitCode === 0
      ? ""
      : `exit ${String(result.exitCode)}: ${result.stderr}\n${result.stdout}`,
  ).toBe("");
  return result.stdout;
};

const bodyOf = async (urlPath: string) => {
  const response = await cli.get(urlPath);
  expect(response.status).toBe(200);
  return response.text();
};

const docker = (args: readonly string[], input?: string) =>
  execFileSync("docker", [...args], {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 15 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });

const BUILD_DEBS = String.raw`
set -euo pipefail
arch="$(dpkg --print-architecture)"
for version in ${VERSIONS.join(" ")}; do
  root="$(mktemp -d)"
  mkdir -p "$root/DEBIAN" "$root/usr/bin"
  cat > "$root/DEBIAN/control" <<EOF
Package: ${PACKAGE}
Version: $version
Architecture: $arch
Maintainer: Example Maintainer <maintainer@example.com>
Depends: bash
Description: Example app shipped through an APT repository
 Installed and upgraded by apt from the better-update server.
EOF
  printf '#!/bin/sh\necho %s\n' "$version" > "$root/usr/bin/${PACKAGE}"
  chmod 755 "$root/usr/bin/${PACKAGE}"
  printf -v name '%s_%s_%s.deb' "${PACKAGE}" "$version" "$arch"
  dpkg-deb --build --root-owner-group "$root" "/work/$name" >/dev/null
done
`;

describe.skipIf(!hasDocker)("APT repository with real apt", () => {
  let workRoot = "";
  let port = "";
  let repoUrl = "";
  const containers: Partial<Record<Distro, string>> = {};

  const debFor = (version: string) => {
    const found = readdirSync(workRoot).find(
      (file) => file.startsWith(`${PACKAGE}_${version}_`) && file.endsWith(".deb"),
    );
    if (found === undefined) {
      throw new Error(`no deb built for ${version}`);
    }
    return path.join(workRoot, found);
  };

  /** Upload one version's deb and release it; returns the release id. */
  const release = (version: string, ...flags: readonly string[]) => {
    expectSuccess(cli.runCli("builds", "upload", "--platform", "linux", debFor(version)));
    const created = JSON.parse(
      expectSuccess(cli.runCli("linux", "release", "create", "--json", ...flags)),
    ) as { readonly data: { readonly id: string } };
    return created.data.id;
  };

  /** Run a script in the distro's long-lived container, keeping its output as evidence. */
  const run = (distro: Distro, step: string, script: string) => {
    const container = containers[distro];
    if (container === undefined) {
      throw new Error(`${distro} container is not running`);
    }
    const output = docker(["exec", container, "bash", "-c", `set -euo pipefail\n${script} 2>&1`]);
    writeFileSync(path.join(workRoot, "logs", `${distro}-${step}.log`), output);
    return output;
  };

  /** apt against this repository only, so the distro's own archives are never fetched. */
  const apt = (command: string) =>
    `apt-get -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/example.list -o Dir::Etc::sourceparts=- -o APT::Machine-ID=${MACHINE_ID} ${command}`;

  const startContainer = (distro: Distro) => {
    const { image, tag } = DISTROS[distro];
    docker(
      ["build", "-q", "-t", tag, "-"],
      `FROM ${image}
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl socat && rm -rf /var/lib/apt/lists/*
`,
    );
    containers[distro] = docker([
      "run",
      "-d",
      "--rm",
      "--init",
      "--add-host=host.docker.internal:host-gateway",
      "-v",
      `${workRoot}:/work`,
      tag,
      "bash",
      "-c",
      // Inside the container 127.0.0.1:<port> is socat, forwarding to the host's test server.
      `socat TCP-LISTEN:${port},bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:${port} & exec sleep infinity`,
    ]).trim();
  };

  /** The key and the `sources.list` line, as the CLI printed them. */
  const addRepository = (distro: Distro) =>
    run(
      distro,
      "add",
      `mkdir -p /etc/apt/keyrings
curl -fsSL "${repoUrl}/key.asc" -o "/etc/apt/keyrings/${cli.getProjectId()}.asc"
echo "deb [signed-by=/etc/apt/keyrings/${cli.getProjectId()}.asc] ${repoUrl} latest main" > /etc/apt/sources.list.d/example.list
${apt("update")}`,
    );

  beforeAll(
    () => {
      workRoot = mkdtempSync(path.join(os.tmpdir(), "apt-repository-e2e-"));
      mkdirSync(path.join(workRoot, "logs"));
      ({ port } = new URL(cli.getBaseUrl()));
      repoUrl = `http://127.0.0.1:${port}/feeds/${cli.getProjectId()}/linux/apt`;
      writeFileSync(
        path.join(cli.getProjectDir(), "eas.json"),
        `${JSON.stringify({ projectId: cli.getProjectId(), build: { production: { linux: {} } } }, null, 2)}\n`,
      );
      startContainer("ubuntu");
      startContainer("debian");
      run("ubuntu", "build-debs", BUILD_DEBS);
    },
    30 * 60 * 1000,
  );

  afterAll(() => {
    for (const container of Object.values(containers)) {
      spawnSync("docker", ["rm", "-f", container], { stdio: "ignore" });
    }
    if (workRoot !== "") {
      rmSync(EVIDENCE_DIR, { recursive: true, force: true });
      mkdirSync(EVIDENCE_DIR, { recursive: true });
      cpSync(path.join(workRoot, "logs"), EVIDENCE_DIR, { recursive: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  test("indexes the deb's own control fields and prints the APT source", async () => {
    const releaseId = release(VERSIONS[0]);
    const listed = expectSuccess(cli.runCli("linux", "release", "list"));
    expect(listed).toContain(`APT source`);
    expect(listed).toContain(`/feeds/${cli.getProjectId()}/linux/apt latest main`);
    const inRelease = await bodyOf(`/feeds/${cli.getProjectId()}/linux/apt/dists/latest/InRelease`);
    expect(inRelease).toContain("\nArchitectures: amd64 arm64 armhf i386\n");
    const debArch = /_(?<arch>[a-z0-9]+)\.deb$/u.exec(debFor(VERSIONS[0]))?.groups?.["arch"];
    const packages = await bodyOf(
      `/feeds/${cli.getProjectId()}/linux/apt/dists/latest/main/binary-${String(debArch)}/Packages`,
    );
    expect(packages).toContain(`Package: ${PACKAGE}\nVersion: ${VERSIONS[0]}\n`);
    expect(packages).toContain("Depends: bash\n");
    expect(packages).toContain(" Installed and upgraded by apt from the better-update server.\n");
    expect(packages).toContain(`Filename: pool/${releaseId}/${PACKAGE}_${VERSIONS[0]}_`);
    expect(packages).toMatch(/\nSHA256: [0-9a-f]{64}\nSHA512: [0-9a-f]{128}\n/u);
  });

  test.each(["ubuntu", "debian"] as const)(
    "%s verifies the signed index and installs the released deb",
    (distro) => {
      const update = addRepository(distro);
      expect(update).not.toMatch(/^(?:W|E|Err):/mu);
      expect(update).toContain(" latest InRelease");
      run(distro, "install", `DEBIAN_FRONTEND=noninteractive ${apt(`install -y ${PACKAGE}`)}`);
      expect(run(distro, "run-installed", PACKAGE).trim()).toBe(VERSIONS[0]);
    },
  );

  test("apt upgrade installs a newer release", () => {
    release(VERSIONS[1]);
    run("ubuntu", "update-1.1", apt("update"));
    run("ubuntu", "upgrade-1.1", `DEBIAN_FRONTEND=noninteractive ${apt("upgrade -y")}`);
    expect(run("ubuntu", "run-1.1", PACKAGE).trim()).toBe(VERSIONS[1]);
  });

  let phasedReleaseId = "";

  test("a partial rollout is phased: held back until rolled out to everyone", () => {
    phasedReleaseId = release(VERSIONS[2], "--rollout", "1");
    run("ubuntu", "update-phased", apt("update"));
    expect(run("ubuntu", "policy-phased", apt("-s upgrade"))).toMatch(/deferred due to phasing/u);
    run("ubuntu", "upgrade-phased", `DEBIAN_FRONTEND=noninteractive ${apt("upgrade -y")}`);
    expect(run("ubuntu", "run-phased", PACKAGE).trim()).toBe(VERSIONS[1]);

    expectSuccess(
      cli.runCli("linux", "release", "rollout", phasedReleaseId, "--percentage", "100"),
    );
    run("ubuntu", "update-rolled-out", apt("update"));
    run("ubuntu", "upgrade-rolled-out", `DEBIAN_FRONTEND=noninteractive ${apt("upgrade -y")}`);
    expect(run("ubuntu", "run-rolled-out", PACKAGE).trim()).toBe(VERSIONS[2]);
  });

  test("a halted release leaves the index", () => {
    expectSuccess(cli.runCli("linux", "release", "halt", phasedReleaseId));
    run("debian", "update-halted", apt("update"));
    const policy = run("debian", "policy-halted", `apt-cache policy ${PACKAGE}`);
    expect(policy).toContain(VERSIONS[1]);
    expect(policy).not.toContain(VERSIONS[2]);
  });
});
