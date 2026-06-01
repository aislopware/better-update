import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseDotenvContent } from "@better-update/dotenv";

const FALLBACKS = {
  assetCdnUrl: "https://assets.better-update.dev",
  betterAuthSecret: "e2e-test-secret-that-is-at-least-32-chars",
  betterAuthUrl: "http://localhost:6781",
  buildBucketName: "better-update",
  cloudflareAccountId: "<account-id>",
  webUrl: "http://localhost:6780",
  githubClientId: "e2e-github-id",
  githubClientSecret: "e2e-github-secret",
  googleClientId: "e2e-google-id",
  googleClientSecret: "e2e-google-secret",
  installTokenSecret: "e2e-install-token-secret-at-least-32-chars",
  publicApiUrl: "http://localhost:6781",
  r2AccessKeyId: "e2e-r2-access-key",
  r2SecretAccessKey: "e2e-r2-secret-key",
  assetsBucketName: "better-update",
} as const;

const parseEnvFile = (filePath: string): Record<string, string> => {
  if (!existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parseDotenvContent(readFileSync(filePath, "utf8"))).filter(
      ([, value]) => value !== "",
    ),
  );
};

const readFileEnvSource = (projectRoot: string) => ({
  ...parseEnvFile(path.resolve(projectRoot, ".env")),
  ...parseEnvFile(path.resolve(projectRoot, ".env.local")),
});

const envValue = (options: {
  readonly fileSource: Record<string, string | undefined>;
  readonly primary: string;
  readonly fallback: string;
  readonly secondary?: string;
}) => {
  const candidates = [
    options.secondary ? process.env[options.secondary] : undefined,
    process.env[options.primary],
    options.secondary ? options.fileSource[options.secondary] : undefined,
    options.fileSource[options.primary],
  ];
  const found = candidates.find((value) => value !== undefined && value !== "");
  return found ?? options.fallback;
};

const toPlainTextBindings = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { type: "plain_text", value }] as const),
  );

export interface ServerE2EEnvironment {
  readonly processOverrides: Record<string, string>;
  readonly workerBindings: Record<string, { readonly type: "plain_text"; readonly value: string }>;
  readonly wranglerEnv: NodeJS.ProcessEnv;
}

export const createServerE2EEnvironment = (options?: {
  readonly projectRoot?: string;
  readonly webUrl?: string;
  readonly publicApiUrl?: string;
}): ServerE2EEnvironment => {
  const projectRoot = options?.projectRoot ?? path.resolve(import.meta.dirname, "../..");
  const fileSource = readFileEnvSource(projectRoot);

  const accountId = envValue({
    fileSource,
    primary: "E2E_CF_ACCOUNT_ID",
    fallback: FALLBACKS.cloudflareAccountId,
    secondary: "ACCOUNT_ID",
  });

  const processOverrides = {
    ACCOUNT_ID: accountId,
    // Wrangler's `unstable_startWorker` reads CLOUDFLARE_ACCOUNT_ID from the
    // environment to disambiguate between multiple authenticated accounts.
    // Without it, the local runtime errors out when the user has more than one
    // account and then silently fails to serve HTTP requests.
    CLOUDFLARE_ACCOUNT_ID: accountId,
    ASSETS_BUCKET_NAME: envValue({
      fileSource,
      primary: "E2E_ASSETS_BUCKET_NAME",
      fallback: FALLBACKS.assetsBucketName,
      secondary: "ASSETS_BUCKET_NAME",
    }),
    ASSET_CDN_URL: envValue({
      fileSource,
      primary: "ASSET_CDN_URL",
      fallback: FALLBACKS.assetCdnUrl,
    }),
    BETTER_AUTH_SECRET: envValue({
      fileSource,
      primary: "BETTER_AUTH_SECRET",
      fallback: FALLBACKS.betterAuthSecret,
    }),
    BETTER_AUTH_URL: envValue({
      fileSource,
      primary: "BETTER_AUTH_URL",
      fallback: FALLBACKS.betterAuthUrl,
    }),
    BUILD_BUCKET_NAME: envValue({
      fileSource,
      primary: "E2E_BUILD_BUCKET_NAME",
      fallback: FALLBACKS.buildBucketName,
      secondary: "BUILD_BUCKET_NAME",
    }),
    // wrangler.jsonc defines COOKIE_DOMAIN=".better-update.dev" for prod.
    // In e2e the worker serves over plain HTTP on 127.0.0.1, so Set-Cookie
    // with Domain=.better-update.dev + Secure gets dropped by browsers and
    // fetch clients — breaking every subsequent authed request. Clearing it
    // makes better-auth emit host-only cookies that ride the proxy cleanly.
    COOKIE_DOMAIN: "",
    CLOUDFLARE_API_TOKEN: envValue({
      fileSource,
      primary: "CLOUDFLARE_API_TOKEN",
      fallback: "",
    }),
    WEB_URL:
      options?.webUrl ??
      envValue({
        fileSource,
        primary: "WEB_URL",
        fallback: FALLBACKS.webUrl,
      }),
    GITHUB_CLIENT_ID: envValue({
      fileSource,
      primary: "GITHUB_CLIENT_ID",
      fallback: FALLBACKS.githubClientId,
    }),
    GITHUB_CLIENT_SECRET: envValue({
      fileSource,
      primary: "GITHUB_CLIENT_SECRET",
      fallback: FALLBACKS.githubClientSecret,
    }),
    GOOGLE_CLIENT_ID: envValue({
      fileSource,
      primary: "GOOGLE_CLIENT_ID",
      fallback: FALLBACKS.googleClientId,
    }),
    GOOGLE_CLIENT_SECRET: envValue({
      fileSource,
      primary: "GOOGLE_CLIENT_SECRET",
      fallback: FALLBACKS.googleClientSecret,
    }),
    INSTALL_TOKEN_SECRET: envValue({
      fileSource,
      primary: "INSTALL_TOKEN_SECRET",
      fallback: FALLBACKS.installTokenSecret,
    }),
    PUBLIC_API_URL:
      options?.publicApiUrl ??
      envValue({
        fileSource,
        primary: "PUBLIC_API_URL",
        fallback: FALLBACKS.publicApiUrl,
      }),
    R2_ACCESS_KEY_ID: envValue({
      fileSource,
      primary: "E2E_R2_ACCESS_KEY_ID",
      fallback: FALLBACKS.r2AccessKeyId,
      secondary: "R2_ACCESS_KEY_ID",
    }),
    R2_SECRET_ACCESS_KEY: envValue({
      fileSource,
      primary: "E2E_R2_SECRET_ACCESS_KEY",
      fallback: FALLBACKS.r2SecretAccessKey,
      secondary: "R2_SECRET_ACCESS_KEY",
    }),
    TEST_MODE: "true",
  } satisfies Record<string, string>;

  return {
    processOverrides,
    workerBindings: toPlainTextBindings(processOverrides),
    wranglerEnv: {
      ...process.env,
      ...processOverrides,
    },
  };
};

export const applyProcessEnv = (overrides: Record<string, string>) => {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(overrides)) {
    previousValues.set(key, process.env[key]);
    process.env[key] = value;
  }

  return () => {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }

      process.env[key] = value;
    }
  };
};
