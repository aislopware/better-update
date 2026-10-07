/**
 * A project's public APT repository, next to its other Linux feeds. A
 * Debian or Ubuntu machine adds it once and then `apt upgrade` installs the
 * deb releases of a channel:
 *
 *   GET /feeds/:projectId/linux/apt/key.asc | key.gpg          signing key
 *   GET /feeds/:projectId/linux/apt/dists/:channel/InRelease   signed index
 *   GET /feeds/:projectId/linux/apt/dists/:channel/main/binary-:arch/Packages
 *   GET /feeds/:projectId/linux/apt/dists/:channel/main/binary-:arch/by-hash/SHA256/:digest
 *   GET /feeds/:projectId/linux/apt/pool/:releaseId/:file.deb  302 to the deb
 *
 * Everything is rendered from the live releases on each request: `InRelease`
 * is never cached, so it always names the `Packages` the server renders now,
 * and apt fetches those by digest (`Acquire-By-Hash`), which the cache may
 * keep for good. The server signs with a key derived per project from
 * `APT_SIGNING_SECRET`; without that secret there is no repository.
 */
import { toHex } from "@better-update/encoding";
import { Effect } from "effect";

import { BuildRuntime } from "../cloudflare/build-runtime";
import {
  APT_ARCHITECTURES,
  aptIndexPath,
  aptPackages,
  parseAptIndexPath,
  parseAptPoolPath,
  renderPackages,
  renderRelease,
} from "../domain/apt-repository";
import { aptSigningKey } from "../domain/apt-signing";
import { CryptoService } from "../domain/crypto-service";
import { DesktopAnalytics } from "../domain/desktop-analytics";
import { DesktopReleaseRepo } from "../repositories/desktop-releases";
import { downloadEffect } from "./desktop-feed-downloads";

import type { AptArchitecture } from "../domain/apt-repository";

const SUITE_ROUTE = /^dists\/(?<channel>[a-z0-9][a-z0-9._-]{0,39})\/(?<file>.+)$/u;
/** Versions a suite lists; older ones only matter to someone pinning one. */
const SUITE_LIMIT = 100;

const notFound = (message = "Not found") =>
  Response.json({ code: "NOT_FOUND", message }, { status: 404 });

const text = (body: string | Uint8Array<ArrayBuffer>, contentType: string, cacheControl: string) =>
  new Response(body, { headers: { "content-type": contentType, "cache-control": cacheControl } });

/** One channel's debs and its four `Packages` indexes, each with its size and SHA-256. */
const renderSuite = (projectId: string, channel: string) =>
  Effect.gen(function* () {
    const entries = yield* (yield* DesktopReleaseRepo).listFeed({
      projectId,
      platform: "linux",
      channel,
      limit: SUITE_LIMIT,
    });
    const packages = aptPackages(entries);
    const crypto = yield* CryptoService;
    // eslint-disable-next-line unicorn/no-array-method-this-argument -- false positive: Effect.forEach(array, f) is not Array.prototype.forEach
    const indexes = yield* Effect.forEach(APT_ARCHITECTURES, (architecture) =>
      Effect.gen(function* () {
        const bytes = new TextEncoder().encode(renderPackages(packages, architecture));
        const sha256 = yield* crypto.digest("SHA-256", bytes);
        return { architecture, bytes, sha256: toHex(sha256) };
      }),
    );
    return { packages, indexes };
  });

const serveInRelease = (
  request: Request,
  params: { readonly projectId: string; readonly channel: string; readonly secret: string },
) =>
  Effect.gen(function* () {
    const { projectId, channel } = params;
    const { packages, indexes } = yield* renderSuite(projectId, channel);
    const now = new Date();
    const release = renderRelease({
      label: projectId,
      channel,
      date: now,
      files: indexes.map((index) => ({
        path: aptIndexPath(index.architecture),
        size: index.bytes.length,
        sha256: index.sha256,
      })),
    });
    const key = yield* aptSigningKey({ secret: params.secret, projectId });
    const signed = yield* key.clearsign(release, now);
    if (request.method === "GET") {
      const [newest] = packages;
      yield* (yield* DesktopAnalytics).recordCheck({
        projectId,
        platform: "linux",
        updater: "apt",
        channel,
        arch: undefined,
        served:
          newest === undefined
            ? undefined
            : { releaseId: newest.entry.id, version: newest.entry.appVersion },
        clientVersion: undefined,
        installId: null,
      });
    }
    return text(signed, "text/plain; charset=utf-8", "no-store");
  });

/** An architecture's `Packages`; by digest only while it is still what the server renders. */
const servePackages = (
  projectId: string,
  channel: string,
  index: { readonly architecture: AptArchitecture; readonly digest: string | undefined },
) =>
  Effect.gen(function* () {
    const { indexes } = yield* renderSuite(projectId, channel);
    const current = indexes.find((candidate) => candidate.architecture === index.architecture);
    if (current === undefined || (index.digest !== undefined && index.digest !== current.sha256)) {
      return notFound();
    }
    return text(
      current.bytes,
      "text/plain; charset=utf-8",
      index.digest === undefined ? "no-store" : "public, max-age=31536000, immutable",
    );
  });

const serveKey = (projectId: string, secret: string, binary: boolean) =>
  Effect.gen(function* () {
    const key = yield* aptSigningKey({ secret, projectId });
    return binary
      ? text(key.publicKey, "application/pgp-keys", "public, max-age=3600")
      : text(key.armoredPublicKey, "application/pgp-keys; charset=utf-8", "public, max-age=3600");
  });

/** A request under `/feeds/:projectId/linux/apt/`, `rest` being the part after it. */
export const aptEffect = (request: Request, projectId: string, rest: string) =>
  Effect.gen(function* () {
    const secret = yield* (yield* BuildRuntime).getAptSigningSecret;
    if (secret === null) {
      return notFound("This server has no APT repository signing key (APT_SIGNING_SECRET)");
    }
    if (rest === "key.asc" || rest === "key.gpg") {
      return yield* serveKey(projectId, secret, rest === "key.gpg");
    }
    const pool = parseAptPoolPath(rest);
    const download =
      pool === undefined
        ? undefined
        : downloadEffect(request, projectId, "linux", `download/${pool.releaseId}/${pool.file}`);
    if (download !== undefined) {
      return yield* download;
    }
    const suite = SUITE_ROUTE.exec(rest)?.groups;
    const channel = suite?.["channel"];
    const file = suite?.["file"];
    if (channel === undefined || file === undefined) {
      return notFound();
    }
    if (file === "InRelease") {
      return yield* serveInRelease(request, { projectId, channel, secret });
    }
    const index = parseAptIndexPath(file);
    return index === undefined ? notFound() : yield* servePackages(projectId, channel, index);
  }).pipe(
    Effect.catchTag("CryptoError", (error) =>
      Effect.logError("APT repository signing failed", error).pipe(
        Effect.as(
          Response.json(
            { code: "INTERNAL_ERROR", message: "Could not sign the repository" },
            { status: 500 },
          ),
        ),
      ),
    ),
  );
