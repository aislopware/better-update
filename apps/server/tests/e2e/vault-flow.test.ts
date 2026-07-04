import { toBase64 } from "@better-update/encoding";
import { env } from "cloudflare:test";

import { credentialEnvelope } from "../helpers/credential-envelope";
import { setupE2EWorker } from "../helpers/e2e-worker-pool";

const { get, parseCookies, post } = setupE2EWorker(".wrangler/state/e2e-vault");

// ── Opaque-blob helpers ───────────────────────────────────────────
// The server is zero-knowledge: every public key, wrap, and DEK is an opaque
// string it stores and relays verbatim. These tests assert on the metadata +
// authz the server enforces around those blobs, not on real crypto (covered by
// the CLI/`credentials-crypto` unit tests), so random base64 is enough.

// Hyphens are harmless in both schemas (`age1…` prefix / `SHA256:` prefix), so a
// raw UUID is a fine unique stand-in without stripping anything.
const rand = () => crypto.randomUUID();
const opaque = () => toBase64(crypto.getRandomValues(new Uint8Array(48)));

const recipientBody = (kind: "device" | "recovery" | "machine", label: string) => ({
  kind,
  publicKey: `age1${rand()}${rand()}`,
  label,
  fingerprint: `SHA256:${rand()}`,
});

const wrapFor = (userEncryptionKeyId: string) => ({ userEncryptionKeyId, wrappedKey: opaque() });

const envWrapFor = (recipientKind: "device" | "recovery" | "machine", recipientId: string) => ({
  recipientKind,
  recipientId,
  wrappedKey: opaque(),
});

const registerKey = async (
  cookie: string,
  kind: "device" | "recovery" | "machine",
  label: string,
) => post("/api/encryption-keys", recipientBody(kind, label), { cookie });

const idOf = async (res: Response): Promise<string> => (await res.json()).id;

// ── Cross-flow: identities → bootstrap → grant/self-link → rotate → revoke ──

describe("Credential vault lifecycle", () => {
  let cookiesA: string;
  let organizationId: string;
  let deviceA: string;
  let deviceA2: string;
  let recovery: string;
  let machine: string;
  let certId: string;
  let rotatedDek: string;

  // ── Section 1: owner signs up + activates an org ────────────────

  it("owner signs up and activates an org", async () => {
    const signup = await post("/api/auth/sign-up/email", {
      name: "Vault Owner",
      email: "vault-owner@example.com",
      password: "SecureP@ss123",
    });
    expect(signup.status).toBe(200);
    cookiesA = parseCookies(signup);

    const orgRes = await post(
      "/api/auth/organization/create",
      { name: "Vault Org", slug: "vault-org" },
      { cookie: cookiesA },
    );
    expect(orgRes.status).toBe(200);
    organizationId = (await orgRes.json()).id;
    cookiesA = parseCookies(orgRes) || cookiesA;

    const active = await post(
      "/api/auth/organization/set-active",
      { organizationId },
      { cookie: cookiesA },
    );
    expect(active.status).toBe(200);
    cookiesA = parseCookies(active) || cookiesA;
  });

  // ── Section 2: register recipient public keys ───────────────────

  it("registers a device key (self-service) plus org-owned recovery + machine keys", async () => {
    const deviceRes = await registerKey(cookiesA, "device", "Owner laptop");
    expect(deviceRes.status).toBe(201);
    const device = await deviceRes.json();
    expect(device.kind).toBe("device");
    expect(device.userId).not.toBeNull();
    expect(device.organizationId).toBeNull();
    deviceA = device.id;

    const recoveryRes = await registerKey(cookiesA, "recovery", "Offline recovery");
    expect(recoveryRes.status).toBe(201);
    const recoveryKey = await recoveryRes.json();
    // Org-owned: no user, bound to the org.
    expect(recoveryKey.userId).toBeNull();
    expect(recoveryKey.organizationId).toBe(organizationId);
    recovery = recoveryKey.id;

    // Machine keys are minted only alongside a robot account (the register
    // endpoint rejects kind=machine) — the robot row carries the vault
    // recipient's `userEncryptionKeyId`. Robots are project-scoped (spec
    // §1b, v2), so mint a fixture project to hang it on.
    const projectRes = await post(
      "/api/projects",
      { name: "Vault Fixture", slug: "vault-fixture" },
      { cookie: cookiesA },
    );
    expect(projectRes.status).toBe(201);
    const fixtureProjectId = (await projectRes.json()).id as string;

    const robotRes = await post(
      "/api/robot-accounts",
      {
        name: "CI runner",
        projectId: fixtureProjectId,
        role: "developer",
        publicKey: `age1${rand()}${rand()}`,
        fingerprint: `SHA256:${rand()}`,
      },
      { cookie: cookiesA },
    );
    expect(robotRes.status).toBe(201);
    const robot = await robotRes.json();
    expect(robot.userEncryptionKeyId).not.toBeNull();
    machine = robot.userEncryptionKeyId;
  });

  it("lists the caller's own device key + the org-owned keys", async () => {
    const res = await get("/api/encryption-keys", { cookie: cookiesA });
    expect(res.status).toBe(200);
    const ids = ((await res.json()).items as { id: string }[]).map((key) => key.id);
    expect(ids).toContain(deviceA);
    expect(ids).toContain(recovery);
    expect(ids).toContain(machine);
  });

  // ── Section 3: bootstrap invariants ─────────────────────────────

  const validEnvWraps = () => [envWrapFor("device", deviceA), envWrapFor("recovery", recovery)];

  it("rejects a bootstrap with no offline recovery recipient", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA)], envWraps: validEnvWraps() },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a bootstrap with a duplicate recipient", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA), wrapFor(deviceA), wrapFor(recovery)], envWraps: validEnvWraps() },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a bootstrap missing env wraps (a CLI too old to born-fork)", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA), wrapFor(recovery)] },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a bootstrap whose env wraps lack a recovery recipient", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA), wrapFor(recovery)], envWraps: [envWrapFor("device", deviceA)] },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("born-forks the vault at version 1 with the device + recovery recipients", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA), wrapFor(recovery)], envWraps: validEnvWraps() },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(201);
    const vault = await res.json();
    expect(vault.organizationId).toBe(organizationId);
    expect(vault.vaultVersion).toBe(1);
    // Born forked: the env vault is active from genesis.
    expect(vault.envVaultCutoverAt).not.toBeNull();
    expect(vault.envVaultVersion).toBe(1);
  });

  it("rejects a second bootstrap of an existing vault", async () => {
    const res = await post(
      "/api/vault",
      { wraps: [wrapFor(deviceA), wrapFor(recovery)], envWraps: validEnvWraps() },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(409);
  });

  it("reads the current vault version and its recipients", async () => {
    const vault = await get("/api/vault", { cookie: cookiesA });
    expect(vault.status).toBe(200);
    expect((await vault.json()).vaultVersion).toBe(1);

    const wraps = await get("/api/vault/wraps", { cookie: cookiesA });
    expect(wraps.status).toBe(200);
    const body = await wraps.json();
    expect(body.vaultVersion).toBe(1);
    const ids = (body.recipients as { userEncryptionKeyId: string }[]).map(
      (recipient) => recipient.userEncryptionKeyId,
    );
    expect(ids.sort()).toEqual([deviceA, recovery].sort());
  });

  it("exposes the born-forked env-vault recipients (device + recovery)", async () => {
    const wraps = await get("/api/env-vault/wraps", { cookie: cookiesA });
    expect(wraps.status).toBe(200);
    const body = await wraps.json();
    expect(body.envVaultVersion).toBe(1);
    const ids = (body.recipients as { recipientId: string }[]).map(
      (recipient) => recipient.recipientId,
    );
    expect(ids.sort()).toEqual([deviceA, recovery].sort());
  });

  // ── Section 4: self-link a device, grant a machine, fetch wraps ──

  it("self-links a second device of the same user (no admin grant needed)", async () => {
    deviceA2 = await idOf(await registerKey(cookiesA, "device", "Owner desktop"));
    const res = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(deviceA2) },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(201);
    expect((await res.json()).userEncryptionKeyId).toBe(deviceA2);
  });

  it("grants the org-owned machine recipient (admin path)", async () => {
    const res = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(machine) },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(201);
  });

  it("fetches a recipient's wrapped key to unwrap locally", async () => {
    const res = await get(`/api/vault/wraps/${deviceA}`, { cookie: cookiesA });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vaultVersion).toBe(1);
    expect(typeof body.wrappedKey).toBe("string");
  });

  it("rejects an addWrap carrying a stale vault version", async () => {
    const res = await post(
      "/api/vault/wraps",
      { vaultVersion: 99, wrap: wrapFor(machine) },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(409);
  });

  it("rejects re-wrapping a recipient that already holds the current key", async () => {
    const res = await post(
      "/api/vault/wraps",
      { vaultVersion: 1, wrap: wrapFor(deviceA) },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(409);
  });

  // ── Section 5: upload a credential, then rotate the vault key ────

  it("uploads a distribution certificate wrapped at the current version", async () => {
    const res = await post(
      "/api/apple/distribution-certificates",
      {
        ...credentialEnvelope(),
        serialNumber: "VAULTSN0001",
        appleTeamIdentifier: "VAULT12345",
        appleTeamName: "Vault Team",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2028-01-01T00:00:00Z",
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(201);
    certId = (await res.json()).id;
  });

  it("refuses a rotation that does not re-wrap every credential", async () => {
    const res = await post(
      "/api/vault/rotate",
      {
        fromVersion: 1,
        recipientWraps: [wrapFor(deviceA), wrapFor(deviceA2), wrapFor(recovery), wrapFor(machine)],
        credentialDeks: [],
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a rotation that drops the offline recovery recipient", async () => {
    const res = await post(
      "/api/vault/rotate",
      {
        fromVersion: 1,
        recipientWraps: [wrapFor(deviceA), wrapFor(deviceA2), wrapFor(machine)],
        credentialDeks: [
          {
            credentialType: "appleDistributionCertificate",
            credentialId: certId,
            wrappedDek: opaque(),
          },
        ],
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(400);
  });

  it("refuses a rotation carrying a stale fromVersion", async () => {
    const res = await post(
      "/api/vault/rotate",
      {
        fromVersion: 99,
        recipientWraps: [wrapFor(deviceA), wrapFor(recovery)],
        credentialDeks: [
          {
            credentialType: "appleDistributionCertificate",
            credentialId: certId,
            wrappedDek: opaque(),
          },
        ],
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(409);
  });

  it("rotates the vault: bumps the version, re-wraps recipients + the credential DEK", async () => {
    rotatedDek = opaque();
    const res = await post(
      "/api/vault/rotate",
      {
        fromVersion: 1,
        recipientWraps: [wrapFor(deviceA), wrapFor(deviceA2), wrapFor(recovery), wrapFor(machine)],
        credentialDeks: [
          {
            credentialType: "appleDistributionCertificate",
            credentialId: certId,
            wrappedDek: rotatedDek,
          },
        ],
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).vaultVersion).toBe(2);

    // The vault row + recipient set moved to v2.
    expect((await (await get("/api/vault", { cookie: cookiesA })).json()).vaultVersion).toBe(2);
    const wraps = await (await get("/api/vault/wraps", { cookie: cookiesA })).json();
    expect(wraps.vaultVersion).toBe(2);
    expect(wraps.recipients).toHaveLength(4);

    // The credential's DEK was re-wrapped under the new key and stamped to v2.
    const download = await get(`/api/apple/distribution-certificates/${certId}/download`, {
      cookie: cookiesA,
    });
    expect(download.status).toBe(200);
    const cert = await download.json();
    expect(cert.vaultVersion).toBe(2);
    expect(cert.wrappedDek).toBe(rotatedDek);
  });

  // ── Section 6: revoke = rotate that drops a recipient ───────────

  it("revokes the machine recipient by rotating without it", async () => {
    const nextDek = opaque();
    const res = await post(
      "/api/vault/rotate",
      {
        fromVersion: 2,
        recipientWraps: [wrapFor(deviceA), wrapFor(deviceA2), wrapFor(recovery)],
        credentialDeks: [
          {
            credentialType: "appleDistributionCertificate",
            credentialId: certId,
            wrappedDek: nextDek,
          },
        ],
      },
      { cookie: cookiesA },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).vaultVersion).toBe(3);

    // The machine recipient is gone from the current recipient set …
    const wraps = await (await get("/api/vault/wraps", { cookie: cookiesA })).json();
    const ids = (wraps.recipients as { userEncryptionKeyId: string }[]).map(
      (recipient) => recipient.userEncryptionKeyId,
    );
    expect(ids).not.toContain(machine);
    expect(ids.sort()).toEqual([deviceA, deviceA2, recovery].sort());

    // … and its wrap can no longer be fetched (revoked).
    const gone = await get(`/api/vault/wraps/${machine}`, { cookie: cookiesA });
    expect(gone.status).toBe(404);

    // The credential rode the rotation to v3.
    const cert = await (
      await get(`/api/apple/distribution-certificates/${certId}/download`, { cookie: cookiesA })
    ).json();
    expect(cert.vaultVersion).toBe(3);
    expect(cert.wrappedDek).toBe(nextDek);
  });

  // ── Section 8: isolation + unauthenticated ──────────────────────

  it("isolates vault reads across organizations and rejects anonymous callers", async () => {
    // An anonymous caller gets no vault access at all.
    expect((await get("/api/vault")).status).toBe(401);

    // A fresh org has no vault, and cannot see another org's recipient keys.
    const otherOrg = await post(
      "/api/auth/organization/create",
      { name: "Other Vault Org", slug: "other-vault-org" },
      { cookie: cookiesA },
    );
    expect(otherOrg.status).toBe(200);
    const otherOrgId = (await otherOrg.json()).id;
    let cookiesOther = parseCookies(otherOrg) || cookiesA;
    const otherActive = await post(
      "/api/auth/organization/set-active",
      { organizationId: otherOrgId },
      { cookie: cookiesOther },
    );
    expect(otherActive.status).toBe(200);
    cookiesOther = parseCookies(otherActive) || cookiesOther;

    expect((await get("/api/vault", { cookie: cookiesOther })).status).toBe(404);
    // `machine` is org A's org-owned key — invisible from the other org.
    expect((await get(`/api/vault/wraps/${machine}`, { cookie: cookiesOther })).status).toBe(404);
  });
});
