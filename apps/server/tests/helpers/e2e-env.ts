import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const FALLBACKS = {
  assetCdnUrl: "https://assets.better-update.dev",
  betterAuthSecret: "e2e-test-secret-that-is-at-least-32-chars",
  betterAuthUrl: "http://localhost:6781",
  buildBucketName: "better-update",
  cloudflareAccountId: "<account-id>",
  dashboardUrl: "http://localhost:6780",
  githubClientId: "e2e-github-id",
  githubClientSecret: "e2e-github-secret",
  installTokenSecret: "e2e-install-token-secret-at-least-32-chars",
  r2AccessKeyId: "e2e-r2-access-key",
  r2SecretAccessKey: "e2e-r2-secret-key",
  assetsBucketName: "better-update",
  vaultKeyring: '{"1":"MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="}',
} as const;

const stripWrappingQuotes = (value: string) => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const parseEnvFile = (filePath: string): Record<string, string> => {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, "utf8")
    .split(/\r?\n/u)
    .reduce<Record<string, string>>((result, line) => {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) {
        return result;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 1) {
        return result;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = stripWrappingQuotes(trimmed.slice(separatorIndex + 1).trim());
      result[key] = value;
      return result;
    }, {});
};

const readFileEnvSource = (projectRoot: string) => ({
  ...parseEnvFile(resolve(projectRoot, ".env")),
  ...parseEnvFile(resolve(projectRoot, ".env.local")),
});

const envValue = (options: {
  readonly fileSource: Record<string, string | undefined>;
  readonly primary: string;
  readonly fallback: string;
  readonly secondary?: string;
}) =>
  (options.secondary ? process.env[options.secondary] : undefined) ??
  process.env[options.primary] ??
  (options.secondary ? options.fileSource[options.secondary] : undefined) ??
  options.fileSource[options.primary] ??
  options.fallback;

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
  readonly dashboardUrl?: string;
}): ServerE2EEnvironment => {
  const projectRoot = options?.projectRoot ?? resolve(import.meta.dirname, "../..");
  const fileSource = readFileEnvSource(projectRoot);

  const processOverrides = {
    ACCOUNT_ID: envValue({
      fileSource,
      primary: "E2E_CF_ACCOUNT_ID",
      fallback: FALLBACKS.cloudflareAccountId,
      secondary: "ACCOUNT_ID",
    }),
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
    CLOUDFLARE_API_TOKEN: envValue({
      fileSource,
      primary: "CLOUDFLARE_API_TOKEN",
      fallback: "",
    }),
    DASHBOARD_URL:
      options?.dashboardUrl ??
      envValue({
        fileSource,
        primary: "DASHBOARD_URL",
        fallback: FALLBACKS.dashboardUrl,
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
    INSTALL_TOKEN_SECRET: envValue({
      fileSource,
      primary: "INSTALL_TOKEN_SECRET",
      fallback: FALLBACKS.installTokenSecret,
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
    VAULT_KEYRING: envValue({
      fileSource,
      primary: "VAULT_KEYRING",
      fallback: FALLBACKS.vaultKeyring,
    }),
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
