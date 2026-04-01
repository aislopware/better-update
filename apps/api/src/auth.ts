import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

import { API_KEY_PREFIX } from "./auth/constants";

export const createAuth = (env: Env) =>
  betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.DASHBOARD_URL].filter(Boolean),
    database: env.DB,

    emailAndPassword: { enabled: true },
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
      useSecureCookies: true,
    },
  });
