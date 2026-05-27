import type { EnvVarEnvironment } from "@better-update/api";

const ENVIRONMENT_OPTIONS: readonly { value: typeof EnvVarEnvironment.Type; label: string }[] = [
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
];

export const ALL_ENVIRONMENTS = ENVIRONMENT_OPTIONS.map((option) => option.value);
