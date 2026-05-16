import type { EnvVarEnvironment } from "@better-update/api";

export const ENV_LABELS: Record<typeof EnvVarEnvironment.Type, string> = {
  development: "Development",
  preview: "Preview",
  production: "Production",
};
