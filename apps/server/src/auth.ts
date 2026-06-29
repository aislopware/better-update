import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { admin, bearer, oneTimeToken, organization } from "better-auth/plugins";
import { Effect } from "effect";

import { API_KEY_PREFIX } from "./auth/constants";
import { findFirstMembershipOrgId } from "./auth/memberships";
import { hashPassword, verifyPassword } from "./auth/password";
import { isSuperadminEmail, parseSuperadminEmails, roleIsSuperadmin } from "./auth/superadmin";
import { provideCloudflareEnv } from "./cloudflare/context";
import { EmailServiceLive } from "./cloudflare/email-service";
import { EmailService } from "./domain/email-service";
import { renderInviteEmail } from "./lib/email-templates";
import { structuredLog } from "./middleware/logging";

const INVITE_SENDER_FROM = "noreply@jmango360.dev";

// Snake_case column mapping for the Better Auth `admin` plugin (role/banned use
// matching column names; only these two need remapping, plus the session
// impersonation back-reference). See migration 0053.
const ADMIN_PLUGIN_SCHEMA = {
  user: { fields: { banReason: "ban_reason", banExpires: "ban_expires" } },
  session: { fields: { impersonatedBy: "impersonated_by" } },
} as const;

// Snake_case column mapping for the `@better-auth/passkey` plugin's `passkey`
// table (migration 0072) — only its camelCase fields need remapping. The plugin
// is registered ONLY when WEBAUTHN_RP_ID is set (see `createAuth`), so this map
// is inert until the web env-vault is enabled.
const PASSKEY_PLUGIN_SCHEMA = {
  passkey: {
    fields: {
      publicKey: "public_key",
      userId: "user_id",
      credentialID: "credential_id",
      deviceType: "device_type",
      backedUp: "backed_up",
      createdAt: "created_at",
    },
  },
} as const;

// Snake_case column mapping for the `organization` plugin's tables (all static —
// no `env` capture — so it lives at module scope). Fine-grained authz now lives in
// the IAM policy/group model (not better-auth dynamic-AC), so the
// `organizationRole` mapping is gone.
const ORGANIZATION_PLUGIN_SCHEMA = {
  session: { fields: { activeOrganizationId: "active_organization_id" } },
  organization: { fields: { createdAt: "created_at" } },
  member: {
    fields: { userId: "user_id", organizationId: "organization_id", createdAt: "created_at" },
  },
  invitation: {
    fields: {
      organizationId: "organization_id",
      inviterId: "inviter_id",
      expiresAt: "expires_at",
      createdAt: "created_at",
    },
  },
} as const;

type AuthEnv = Env & {
  readonly GITHUB_CLIENT_ID?: string;
  readonly GITHUB_CLIENT_SECRET?: string;
  readonly GOOGLE_CLIENT_ID?: string;
  readonly GOOGLE_CLIENT_SECRET?: string;
  readonly SUPERADMIN_EMAILS?: string;
  readonly TEST_MODE?: string;
  // WebAuthn / passkey config for the web env-vault step-up (P4). When
  // WEBAUTHN_RP_ID is unset the passkey plugin is NOT registered (prod default).
  // Passkeys are used ONLY on the vault origin (the step-up + enrollment both run
  // there), so WEBAUTHN_RP_ID is that exact host — `updates-vault.jmango360.dev` —
  // which binds each credential to the vault origin alone (a passkey's rpID must be
  // a registrable suffix of the origin it is used on; the exact host is the most
  // restrictive valid value). It deliberately does NOT cover the dashboard
  // `updates.jmango360.dev`: enrollment there is redirected to the vault origin.
  readonly WEBAUTHN_RP_ID?: string;
  readonly WEBAUTHN_RP_NAME?: string;
  // Comma-separated allowed WebAuthn origins. With rpID scoped to the vault host
  // this is just the vault origin, e.g. "https://updates-vault.jmango360.dev"; the
  // dashboard origin stays a trusted origin via BETTER_AUTH_URL.
  readonly WEBAUTHN_ORIGINS?: string;
  // Registrable domain to scope the session cookie to (e.g. ".jmango360.dev") so
  // the vault origin — a sibling of the dashboard — carries the dashboard session.
  // UNSET = host-only cookies (the prod default, unchanged). Setting it is a
  // deliberate go-live step: it widens the session cookie to ALL first-party
  // subdomains of that registrable domain and forces a one-time re-login as the
  // host-only cookie is replaced by the domain-scoped one. Without it the vault
  // origin cannot obtain a session (OAuth sign-in lands host-only on the
  // dashboard origin), so the env-vault UI is unreachable. See spec 11b.
  readonly WEBAUTHN_COOKIE_DOMAIN?: string;
};

// A user may create/use organizations only once approved (or if they are a
// superadmin). Org creation runs through Better Auth's own routes, not our
// HttpApi middleware, so it needs its own gate. Read straight from D1 rather
// than trusting the session (the compact cookie cache may omit custom fields).
const isUserApprovedOrAdmin = async (db: D1Database, userId: string): Promise<boolean> => {
  const row = await db
    .prepare(`SELECT "approved", "role" FROM "user" WHERE "id" = ?`)
    .bind(userId)
    .first<{ approved: number | null; role: string | null }>();
  if (!row) {
    return false;
  }
  return row.approved === 1 || roleIsSuperadmin(row.role);
};

const trimOptionalBinding = (value: string | undefined): string =>
  // eslint-disable-next-line eslint-js/no-restricted-syntax -- optional OAuth env feature-gate; empty string means feature disabled
  value?.trim() ?? "";

export const isGithubEnabled = (env: AuthEnv): boolean => {
  const id = trimOptionalBinding(env.GITHUB_CLIENT_ID);
  const secret = trimOptionalBinding(env.GITHUB_CLIENT_SECRET);
  return id.length > 0 && secret.length > 0;
};

export const isGoogleEnabled = (env: AuthEnv): boolean => {
  const id = trimOptionalBinding(env.GOOGLE_CLIENT_ID);
  const secret = trimOptionalBinding(env.GOOGLE_CLIENT_SECRET);
  return id.length > 0 && secret.length > 0;
};

export const createAuth = (env: AuthEnv, ctx?: ExecutionContext) => {
  const githubClientId = trimOptionalBinding(env.GITHUB_CLIENT_ID);
  const githubClientSecret = trimOptionalBinding(env.GITHUB_CLIENT_SECRET);
  const githubEnabled = githubClientId.length > 0 && githubClientSecret.length > 0;
  const googleClientId = trimOptionalBinding(env.GOOGLE_CLIENT_ID);
  const googleClientSecret = trimOptionalBinding(env.GOOGLE_CLIENT_SECRET);
  const googleEnabled = googleClientId.length > 0 && googleClientSecret.length > 0;
  const testMode = env.TEST_MODE === "true";
  const superadminEmails = parseSuperadminEmails(env.SUPERADMIN_EMAILS);

  // WebAuthn step-up for the web env-vault. The passkey plugin is added ONLY when
  // an RP id is configured; with it unset (the prod default today) the auth
  // surface is byte-identical to before P4 — no /api/auth/passkey/* routes.
  const webauthnRpId = trimOptionalBinding(env.WEBAUTHN_RP_ID);
  const webauthnEnabled = webauthnRpId.length > 0;
  const webauthnRpNameRaw = trimOptionalBinding(env.WEBAUTHN_RP_NAME);
  const webauthnRpName = webauthnRpNameRaw.length > 0 ? webauthnRpNameRaw : "Better Update";
  const webauthnOrigins = trimOptionalBinding(env.WEBAUTHN_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // Registrable domain to share the session cookie across the dashboard + vault
  // sibling origins. Empty = host-only cookies (prod default, unchanged).
  const webauthnCookieDomain = trimOptionalBinding(env.WEBAUTHN_COOKIE_DOMAIN);

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // When the web env vault is enabled, its UI is served from an independent
    // origin (updates-vault.<host>) that authenticates against this worker
    // same-origin. Trust the configured WebAuthn origins so better-auth's CSRF
    // check accepts their requests; `baseURL` stays included as the canonical
    // origin. Omitted (default = [baseURL]) until the flag is set, so the prod
    // auth surface is byte-identical to before P4.
    ...(webauthnEnabled
      ? { trustedOrigins: [...new Set([env.BETTER_AUTH_URL, ...webauthnOrigins])] }
      : {}),
    database: env.DB,
    logger: testMode ? { disabled: true } : undefined,

    emailAndPassword: {
      enabled: testMode,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    socialProviders: {
      ...(githubEnabled
        ? { github: { clientId: githubClientId, clientSecret: githubClientSecret } }
        : {}),
      ...(googleEnabled
        ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
        : {}),
    },

    user: {
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      // Superadmin-approval gate. `input: false` keeps clients from setting it
      // on sign-up; new users default to unapproved and stay gated (see
      // `auth/middleware.ts`) until a superadmin approves them.
      additionalFields: {
        approved: {
          type: "boolean",
          defaultValue: false,
          input: false,
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 300,
        strategy: "compact",
      },
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: [
          "credential",
          ...(githubEnabled ? (["github"] as const) : []),
          ...(googleEnabled ? (["google"] as const) : []),
        ],
      },
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    verification: {
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    secondaryStorage: {
      get: async (key) => env.SESSION_KV.get(key),
      set: async (key, value, ttl) =>
        env.SESSION_KV.put(key, value, ttl ? { expirationTtl: ttl } : undefined),
      delete: async (key) => env.SESSION_KV.delete(key),
    },

    plugins: [
      organization({
        allowUserToCreateOrganization: async (user) => isUserApprovedOrAdmin(env.DB, user.id),
        organizationLimit: 5,
        membershipLimit: 100,
        creatorRole: "owner",
        // Fine-grained authz is the IAM policy/group model (auth/policy.ts), not
        // better-auth roles. The org creator gets `member.role = "owner"` (root).
        // No custom `ac`/`roles` is configured, so this plugin keeps its DEFAULT
        // org AC (owner|admin|member). The unified-authz clients (web/CLI) do NOT
        // call its invite-member / update-member-role / remove-member / org-update
        // routes — those moved to IAM-gated ManagementApi endpoints (/api/invitations,
        // /api/members, PATCH /api/organization) — but the routes stay LIVE and
        // owner-reachable. They are authz-neutral: a member.role written here (e.g.
        // "admin" via the default-AC invite route) grants NOTHING in the IAM gate
        // (only "owner" is read, for the root bypass) and the Members table renders
        // any non-owner role as "Member". Tightening invitable roles via a custom
        // `ac` is optional hardening.
        //
        // INTENTIONALLY left on better-auth (NOT migrated to IAM):
        //   - org CREATE: a pre-org platform gate (allowUserToCreateOrganization,
        //     superadmin-approval); IAM cannot evaluate it — no actor/org context yet.
        //   - org DELETE: stays owner-only here because its destructive cross-table
        //     cascade (projects [no org-cascade FK], api keys [no FK], + their
        //     children) is delegated to better-auth's deleteOrganization. Reimplementing
        //     that cascade in an IAM endpoint is deferred (see permissions.ts).
        sendInvitationEmail: async (data) => {
          const acceptUrl = `${env.BETTER_AUTH_URL}/accept-invitation?id=${data.id}`;
          const inviterTrimmed = data.inviter.user.name.trim();
          const inviterName = inviterTrimmed.length > 0 ? inviterTrimmed : data.inviter.user.email;
          const rendered = renderInviteEmail({
            inviterName,
            organizationName: data.organization.name,
            recipientEmail: data.email,
            role: data.role,
            acceptUrl,
          });

          const program = Effect.gen(function* () {
            const emailService = yield* EmailService;
            yield* emailService.send({
              from: INVITE_SENDER_FROM,
              to: data.email,
              subject: rendered.subject,
              html: rendered.html,
              text: rendered.text,
            });
          }).pipe(
            Effect.provide(EmailServiceLive),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                structuredLog("error", "sendInvitationEmail failed", {
                  invitationId: data.id,
                  recipient: data.email,
                  cause: error.cause instanceof Error ? error.cause.message : String(error.cause),
                });
              }),
            ),
          );

          await Effect.runPromise(provideCloudflareEnv(program, env));
        },
        schema: ORGANIZATION_PLUGIN_SCHEMA,
      }),
      apiKey(
        [
          {
            configId: "default",
            defaultPrefix: API_KEY_PREFIX,
            references: "organization",
            enableMetadata: true,
            keyExpiration: {
              defaultExpiresIn: null,
              minExpiresIn: 86_400,
            },
            rateLimit: {
              enabled: true,
              timeWindow: 60_000,
              maxRequests: 120,
            },
          },
        ],
        {
          schema: {
            apikey: {
              fields: {
                configId: "config_id",
                referenceId: "reference_id",
                refillInterval: "refill_interval",
                refillAmount: "refill_amount",
                lastRefillAt: "last_refill_at",
                rateLimitEnabled: "rate_limit_enabled",
                rateLimitTimeWindow: "rate_limit_time_window",
                rateLimitMax: "rate_limit_max",
                requestCount: "request_count",
                lastRequest: "last_request",
                expiresAt: "expires_at",
                createdAt: "created_at",
                updatedAt: "updated_at",
              },
            },
          },
        },
      ),
      // CLI session auth: `bearer` lets a Better Auth session token ride on the
      // `Authorization: Bearer` header (its before-hook rewrites it into the
      // session cookie so `getSession` resolves it; its after-hook surfaces the
      // token via `set-auth-token` on sign-in/verify). `oneTimeToken` is the
      // browser→CLI handoff: the dashboard mints a short-lived token the CLI
      // exchanges for a session. See docs/specs/build/02-credential-vault.md.
      bearer(),
      oneTimeToken({ expiresIn: 3 }),
      // Global (cross-org) role + ban bookkeeping. `role: "admin"` marks a
      // superadmin who can approve users from the dashboard `/admin` page.
      // Columns: see migration 0053 (ban_reason/ban_expires/impersonated_by are
      // snake_case-mapped here).
      admin({ defaultRole: "user", adminRoles: ["admin"], schema: ADMIN_PLUGIN_SCHEMA }),
      // WebAuthn / passkey: the second factor that gates web env-vault access (P4).
      // Registered only when WEBAUTHN_RP_ID is set so the prod auth surface is
      // unchanged until the org cuts over to the browser env vault. rpID is the
      // vault origin host exactly (updates-vault.jmango360.dev) — passkeys are used
      // only there (step-up + enrollment), so each credential is bound to that
      // origin alone and is NOT usable on the dashboard (updates.jmango360.dev);
      // the `passkey` table already exists (migration 0072). See the web-vault
      // step-up handler + assert-web-env-step-up gate.
      ...(webauthnEnabled
        ? [
            passkey({
              rpID: webauthnRpId,
              rpName: webauthnRpName,
              ...(webauthnOrigins.length > 0 ? { origin: webauthnOrigins } : {}),
              schema: PASSKEY_PLUGIN_SCHEMA,
            }),
          ]
        : []),
    ],

    databaseHooks: {
      user: {
        create: {
          // Bootstrap: a user whose email is in SUPERADMIN_EMAILS is promoted to
          // global admin and auto-approved on first sign-up. Everyone else keeps
          // the `approved` default (false) and stays gated until approved.
          // eslint-disable-next-line typescript/require-await -- better-auth's create.before type requires a Promise return; the bootstrap check is synchronous
          before: async (user) => {
            if (isSuperadminEmail(user.email, superadminEmails)) {
              return { data: { ...user, role: "admin", approved: true } };
            }
            // Email/password sign-up only runs in TEST_MODE; auto-approve those
            // users so the e2e/integration suites exercise the app as approved
            // users. Real (OAuth) sign-ups stay gated until a superadmin approves.
            if (testMode) {
              return { data: { ...user, approved: true } };
            }
            return { data: user };
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const organizationId = await findFirstMembershipOrgId(env.DB, session.userId);
            if (organizationId === null) {
              return { data: session };
            }
            return {
              data: { ...session, activeOrganizationId: organizationId },
            };
          },
        },
      },
    },

    advanced: {
      useSecureCookies: true,
      // Share the session cookie across the dashboard + vault sibling origins so
      // the vault origin (which calls /api same-origin) carries the dashboard
      // session. Only when WEBAUTHN_COOKIE_DOMAIN is set — host-only otherwise, so
      // the prod cookie behaviour is byte-identical until this go-live step. The
      // cookie prefix stays `__Secure-` (not `__Host-`), so a Domain is allowed.
      ...(webauthnCookieDomain.length > 0
        ? { crossSubDomainCookies: { enabled: true, domain: webauthnCookieDomain } }
        : {}),
      ...(ctx
        ? {
            backgroundTasks: {
              handler: (promise: Promise<unknown>) => {
                ctx.waitUntil(promise);
              },
            },
          }
        : {}),
    },
  });
};
