import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

import { API_KEY_PREFIX } from "./auth/constants";

// --- Workers-compatible password hashing (PBKDF2 via Web Crypto) ---
// Better Auth's default scrypt (N:16384, r:16) needs ~64 MB and crashes workerd.

const PBKDF2_ITERATIONS = 100_000;

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((hex.match(/.{2}/g) ?? []).map((byte) => Number.parseInt(byte, 16)));

const deriveKey = async (password: string, salt: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
};

const hashPassword = async (password: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = new Uint8Array(await deriveKey(password, salt));
  return `${toHex(salt)}:${toHex(derived)}`;
};

const verifyPassword = async ({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> => {
  const [saltHex, keyHex] = hash.split(":");
  if (!saltHex || !keyHex) {
    return false;
  }
  const derived = new Uint8Array(await deriveKey(password, fromHex(saltHex)));
  const expected = fromHex(keyHex);
  if (derived.length !== expected.length) {
    return false;
  }
  // Constant-time comparison — reduce with XOR to avoid timing side-channels
  // eslint-disable-next-line no-bitwise -- intentional constant-time XOR comparison
  const result = derived.reduce((acc, byte, idx) => acc | (byte ^ (expected.at(idx) ?? 0)), 0);
  return result === 0;
};

export const createAuth = (env: Env) =>
  betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.DASHBOARD_URL].filter(Boolean),
    database: env.DB,

    emailAndPassword: {
      enabled: true,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },

    user: {
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
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
        trustedProviders: ["credential", "github"],
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
        allowUserToCreateOrganization: true,
        organizationLimit: 5,
        membershipLimit: 100,
        creatorRole: "owner",
        schema: {
          session: {
            fields: {
              activeOrganizationId: "active_organization_id",
            },
          },
          organization: {
            fields: {
              createdAt: "created_at",
            },
          },
          member: {
            fields: {
              userId: "user_id",
              organizationId: "organization_id",
              createdAt: "created_at",
            },
          },
          invitation: {
            fields: {
              organizationId: "organization_id",
              inviterId: "inviter_id",
              expiresAt: "expires_at",
              createdAt: "created_at",
            },
          },
        },
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
    ],

    advanced: {
      useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
    },
  });
