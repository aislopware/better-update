import { Effect } from "effect";

import { provideCloudflareEnv } from "../cloudflare/context";
import { inferDeviceClass, isValidIdentifier, normalizeIdentifier } from "../domain/device";
import { ServerInfrastructureLayer } from "../infrastructure-layer";
import {
  buildDeviceRegistrationProfile,
  parseProfileCallbackPlist,
  renderRegistrationDoneHtml,
  renderRegistrationErrorHtml,
  renderRegistrationLandingHtml,
} from "../lib/mobileconfig";
import { toDbNull } from "../lib/nullable";
import { DeviceRegistrationRequestRepo, DeviceRepo } from "../repositories";

import type { ServerInfrastructure } from "../infrastructure-layer";
import type { DeviceClass, DeviceRegistrationRequestModel } from "../models";

const REGISTER_PATH =
  /^\/register-device\/(?<deviceId>[a-f0-9-]{36})(?<suffix>\/profile\.mobileconfig|\/callback)?$/iu;

const runInfra = async <Success, Failure>(
  effect: Effect.Effect<Success, Failure, ServerInfrastructure>,
  env: Env,
) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(ServerInfrastructureLayer), (program) =>
      provideCloudflareEnv(program, env),
    ),
  );

const findRequestOptional = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* DeviceRegistrationRequestRepo;
    return yield* repo.findById({ id });
  }).pipe(
    Effect.catchTag("NotFound", () =>
      Effect.succeed(null as DeviceRegistrationRequestModel | null),
    ),
  );

const htmlResponse = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const isExpired = (expiresAt: string, now: Date = new Date()): boolean =>
  new Date(expiresAt).getTime() < now.getTime();

const handleLanding = async (env: Env, id: string): Promise<Response> => {
  const req = await runInfra(findRequestOptional(id), env);
  if (req === null) {
    return htmlResponse(renderRegistrationErrorHtml("Registration request not found."), 404);
  }
  if (req.consumedAt !== null) {
    return htmlResponse(
      renderRegistrationErrorHtml("This registration link has already been used."),
      410,
    );
  }
  if (isExpired(req.expiresAt)) {
    return htmlResponse(renderRegistrationErrorHtml("This registration link has expired."), 410);
  }

  const origin = env.PUBLIC_API_URL;
  return htmlResponse(
    renderRegistrationLandingHtml({
      profileUrl: `${origin}/register-device/${id}/profile.mobileconfig`,
      deviceNameHint: req.deviceNameHint,
      expiresAt: req.expiresAt,
    }),
  );
};

const handleProfile = async (env: Env, id: string): Promise<Response> => {
  const req = await runInfra(findRequestOptional(id), env);
  if (req === null) {
    return new Response("Not found", { status: 404 });
  }
  if (req.consumedAt !== null || isExpired(req.expiresAt)) {
    return new Response("Gone", { status: 410 });
  }

  const origin = env.PUBLIC_API_URL;
  const profileUuid = crypto.randomUUID();
  const xml = buildDeviceRegistrationProfile({
    requestId: id,
    callbackUrl: `${origin}/register-device/${id}/callback`,
    organization: "Better Update",
    profileUuid,
  });

  return new Response(xml, {
    headers: {
      "content-type": "application/x-apple-aspen-config",
      "content-disposition": 'attachment; filename="device-registration.mobileconfig"',
      "cache-control": "no-store",
    },
  });
};

interface ConsumeCallbackDeps {
  readonly requestId: string;
  readonly identifier: string;
  readonly deviceName: string;
  readonly deviceClass: DeviceClass;
  readonly model: string | null;
  readonly now: Date;
}

type ConsumeCallbackResult =
  | { readonly ok: true; readonly deviceName: string }
  | { readonly ok: false; readonly message: string };

const consumeCallback = (deps: ConsumeCallbackDeps) =>
  Effect.gen(function* () {
    const inviteRepo = yield* DeviceRegistrationRequestRepo;
    const deviceRepo = yield* DeviceRepo;

    const invite = yield* inviteRepo
      .findById({ id: deps.requestId })
      .pipe(
        Effect.catchTag("NotFound", () =>
          Effect.succeed(null as DeviceRegistrationRequestModel | null),
        ),
      );
    if (invite === null) {
      return { ok: false, message: "Registration link not found." } as ConsumeCallbackResult;
    }
    if (invite.consumedAt !== null) {
      return {
        ok: false,
        message: "Registration link already used.",
      } as ConsumeCallbackResult;
    }
    if (isExpired(invite.expiresAt, deps.now)) {
      return { ok: false, message: "Registration link has expired." } as ConsumeCallbackResult;
    }

    const existing = yield* deviceRepo
      .findByIdentifier({
        organizationId: invite.organizationId,
        appleTeamId: invite.appleTeamId,
        identifier: deps.identifier,
      })
      .pipe(Effect.catchTag("NotFound", () => Effect.succeed(null)));

    const iso = deps.now.toISOString();
    const deviceId = existing === null ? crypto.randomUUID() : existing.id;
    if (existing === null) {
      yield* deviceRepo
        .insert({
          id: deviceId,
          organizationId: invite.organizationId,
          appleTeamId: invite.appleTeamId,
          identifier: deps.identifier,
          name: deps.deviceName,
          model: deps.model,
          deviceClass: deps.deviceClass,
          enabled: true,
          appleDevicePortalId: null,
          createdAt: iso,
          updatedAt: iso,
        })
        .pipe(Effect.catchTag("Conflict", () => Effect.void));
    }

    yield* inviteRepo.markConsumed({
      id: deps.requestId,
      consumedDeviceId: deviceId,
      consumedAt: iso,
    });

    return { ok: true, deviceName: deps.deviceName } as ConsumeCallbackResult;
  });

const handleCallback = async (request: Request, env: Env, id: string): Promise<Response> => {
  const body = await request.text();
  const parsed = parseProfileCallbackPlist(body);
  const rawUdid = parsed["UDID"];
  if (rawUdid === undefined || rawUdid === "") {
    return htmlResponse(renderRegistrationErrorHtml("Missing UDID in callback."), 400);
  }

  const identifier = normalizeIdentifier(rawUdid);
  if (!isValidIdentifier(identifier)) {
    return htmlResponse(renderRegistrationErrorHtml("Invalid UDID format."), 400);
  }

  const product = toDbNull(parsed["PRODUCT"]);
  const deviceNameRaw = parsed["DEVICE_NAME"];
  const deviceName =
    deviceNameRaw !== undefined && deviceNameRaw.length > 0
      ? deviceNameRaw
      : (product ?? "Registered device");
  const deviceClass = inferDeviceClass(identifier);

  const result = await runInfra(
    consumeCallback({
      requestId: id,
      identifier,
      deviceName,
      deviceClass,
      model: product,
      now: new Date(),
    }),
    env,
  );

  if (!result.ok) {
    return htmlResponse(renderRegistrationErrorHtml(result.message), 410);
  }

  return htmlResponse(renderRegistrationDoneHtml(result.deviceName));
};

export const matchDeviceRegistrationRoute = async (
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> => {
  const match = REGISTER_PATH.exec(pathname);
  if (!match?.[1]) {
    return null;
  }
  const [, id, suffix] = match;

  if (suffix === undefined && request.method === "GET") {
    return handleLanding(env, id);
  }
  if (suffix === "/profile.mobileconfig" && request.method === "GET") {
    return handleProfile(env, id);
  }
  if (suffix === "/callback" && request.method === "POST") {
    return handleCallback(request, env, id);
  }

  return new Response("Method not allowed", { status: 405 });
};
