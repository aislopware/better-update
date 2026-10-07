import { createHash } from "node:crypto";

import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, patch, post } = setupE2EWorker(".wrangler/state/e2e-apt-repository");

/**
 * A project's APT repository through the real Worker + D1: the signed
 * `InRelease` naming each architecture's `Packages` by digest, those indexes
 * by path and by digest, phasing, halting, the pool redirect and the signing
 * key. Real apt reading it is `apps/cli/tests/slow/apt-repository.test.ts`.
 */
describe("APT repository flow", () => {
  let cookies: string;
  let projectId: string;
  const releases: Record<string, string> = {};

  const bytes = Buffer.from("e2e deb");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sha512 = createHash("sha512").update(bytes).digest("base64");

  const control = (version: string, arch: string) =>
    `Package: example-desktop\nVersion: ${version}\nArchitecture: ${arch}\nMaintainer: Example <maintainer@example.com>\nDescription: Example desktop app\n An app.\n`;

  const releasedDeb = async (params: {
    readonly version: string;
    readonly arch: "x64" | "arm64";
    readonly debControl?: string;
    readonly rolloutPercentage?: number;
  }) => {
    const reserved = await post(
      "/api/builds",
      {
        projectId,
        platform: "linux",
        distribution: "direct",
        artifactFormat: "deb",
        appVersion: params.version,
        bundleId: "com.example.desktop",
        sha256,
        byteSize: bytes.byteLength,
        metadata: {
          linux: {
            architectures: [params.arch],
            packageName: "example-desktop",
            ...(params.debControl === undefined ? {} : { debControl: params.debControl }),
          },
        },
      },
      { cookie: cookies },
    );
    expect(reserved.status).toBe(201);
    const { id: buildId } = await reserved.json<{ id: string }>();
    const complete = await post(
      `/api/builds/${buildId}/complete`,
      { sha256, byteSize: bytes.byteLength },
      { cookie: cookies },
    );
    expect(complete.status).toBe(200);
    const released = await post(
      `/api/projects/${projectId}/desktop-releases`,
      {
        buildId,
        channel: "latest",
        sha512,
        ...(params.rolloutPercentage === undefined
          ? {}
          : { rolloutPercentage: params.rolloutPercentage }),
      },
      { cookie: cookies },
    );
    expect(released.status).toBe(201);
    const { id } = await released.json<{ id: string }>();
    return id;
  };

  const repo = async (path: string) => get(`/feeds/${projectId}/linux/apt/${path}`);

  const statusOf = async (path: string) => {
    const response = await repo(path);
    return response.status;
  };

  const bytesOf = async (path: string) => {
    const response = await repo(path);
    expect(response.status).toBe(200);
    return new Uint8Array(await response.arrayBuffer());
  };

  const textOf = async (path: string) => new TextDecoder().decode(await bytesOf(path));

  /** The Release inside `InRelease`, and the digest it names for each index. */
  const inRelease = async () => {
    const response = await repo("dists/latest/InRelease");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    const digests = Object.fromEntries(
      [
        ...text.matchAll(
          /^ (?<digest>[0-9a-f]{64}) +(?<size>\d+) main\/binary-(?<arch>\w+)\/Packages$/gmu,
        ),
      ].map((match) => [match.groups?.["arch"], match.groups?.["digest"]]),
    );
    return { text, digests };
  };

  it("bootstraps a user, organization and project", async () => {
    const signUp = await post("/api/auth/sign-up/email", {
      name: "APT Repository User",
      email: "apt-repository-e2e@example.com",
      password: "SecureP@ss123",
    });
    expect(signUp.status).toBe(200);
    cookies = parseCookies(signUp);
    const org = await post(
      "/api/auth/organization/create",
      { name: "APT Repository Org", slug: "apt-repository-org" },
      { cookie: cookies },
    );
    expect(org.status).toBe(200);
    const { id: organizationId } = await org.json<{ id: string }>();
    cookies = parseCookies(org) || cookies;
    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookies },
    );
    cookies = parseCookies(active) || cookies;
    const project = await post(
      "/api/projects",
      { name: "APT Repository Project", slug: "apt-repository" },
      { cookie: cookies },
    );
    expect(project.status).toBe(201);
    ({ id: projectId } = await project.json<{ id: string }>());
  });

  it("serves an empty but signed suite before anything is released", async () => {
    const { text, digests } = await inRelease();
    expect(text).toMatch(/^-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nOrigin: /u);
    expect(text).toContain("\n-----BEGIN PGP SIGNATURE-----\n");
    expect(Object.keys(digests).toSorted()).toStrictEqual(["amd64", "arm64", "armhf", "i386"]);
    const empty = createHash("sha256").update("").digest("hex");
    expect(Object.values(digests)).toStrictEqual([empty, empty, empty, empty]);
  });

  it("serves the same signing key every time, armored and binary", async () => {
    const first = await repo("key.asc");
    expect(first.status).toBe(200);
    const armored = new TextDecoder().decode(await first.arrayBuffer());
    expect(armored).toMatch(/^-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n/u);
    await expect(textOf("key.asc")).resolves.toBe(armored);
    const binary = await bytesOf("key.gpg");
    // A new-format public key packet (tag 6) comes first.
    expect(binary[0]).toBe(0xc6);
  });

  it("indexes released debs that carry their control file, phasing partial rollouts", async () => {
    releases["amd64"] = await releasedDeb({
      version: "1.0.0",
      arch: "x64",
      debControl: control("1.0.0", "amd64"),
    });
    releases["noControl"] = await releasedDeb({ version: "1.1.0", arch: "x64" });
    releases["arm64"] = await releasedDeb({
      version: "1.0.0",
      arch: "arm64",
      debControl: control("1.0.0", "arm64"),
      rolloutPercentage: 30,
    });

    const { digests } = await inRelease();
    const amd64 = await repo("dists/latest/main/binary-amd64/Packages");
    expect(amd64.headers.get("cache-control")).toBe("no-store");
    const amd64Text = await amd64.text();
    expect(createHash("sha256").update(amd64Text).digest("hex")).toBe(digests["amd64"]);
    expect(amd64Text).toBe(
      `${control("1.0.0", "amd64")}Filename: pool/${releases["amd64"]}/example-desktop_1.0.0_amd64.deb\nSize: ${String(bytes.byteLength)}\nSHA256: ${sha256}\nSHA512: ${Buffer.from(sha512, "base64").toString("hex")}\n`,
    );
    const arm64 = await textOf("dists/latest/main/binary-arm64/Packages");
    expect(arm64).toContain("\nPhased-Update-Percentage: 30\n");
  });

  it("serves an index by the digest InRelease names, and no other", async () => {
    const { digests } = await inRelease();
    const byHash = await repo(
      `dists/latest/main/binary-amd64/by-hash/SHA256/${String(digests["amd64"])}`,
    );
    expect(byHash.status).toBe(200);
    expect(byHash.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const stale = await repo(`dists/latest/main/binary-amd64/by-hash/SHA256/${"0".repeat(64)}`);
    expect(stale.status).toBe(404);
    await expect(statusOf("dists/latest/main/binary-ppc64el/Packages")).resolves.toBe(404);
    await expect(statusOf("dists/Not-A-Channel/InRelease")).resolves.toBe(404);
  });

  it("redirects a pool path to the deb, and only a live release's", async () => {
    const pool = await repo(`pool/${String(releases["amd64"])}/example-desktop_1.0.0_amd64.deb`);
    expect(pool.status).toBe(302);
    expect(pool.headers.get("location")).toContain(
      "filename%3D%22example-desktop_1.0.0_amd64.deb%22",
    );
    const unknown = await repo("pool/0190f0aa-0000-7000-8000-00000000dead/example.deb");
    expect(unknown.status).toBe(404);
  });

  it("drops a halted release from the index", async () => {
    const halted = await patch(
      `/api/desktop-releases/${String(releases["amd64"])}`,
      { halted: true },
      { cookie: cookies },
    );
    expect(halted.status).toBe(200);
    await expect(textOf("dists/latest/main/binary-amd64/Packages")).resolves.toBe("");
    const pool = await repo(`pool/${String(releases["amd64"])}/example-desktop_1.0.0_amd64.deb`);
    expect(pool.status).toBe(404);
  });
});
