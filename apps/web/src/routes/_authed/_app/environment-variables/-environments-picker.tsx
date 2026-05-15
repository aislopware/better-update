import { Checkbox } from "@better-update/ui/components/ui/checkbox";

import type { EnvVarEnvironment } from "@better-update/api";

const ENVIRONMENT_OPTIONS: readonly { value: typeof EnvVarEnvironment.Type; label: string }[] = [
  { value: "development", label: "Development" },
  { value: "preview", label: "Preview" },
  { value: "production", label: "Production" },
];

export const ALL_ENVIRONMENTS = ENVIRONMENT_OPTIONS.map((option) => option.value);

const isEnvironment = (value: string): value is typeof EnvVarEnvironment.Type =>
  value === "development" || value === "preview" || value === "production";

export const EnvironmentsPicker = ({
  value,
  onChange,
  disabled,
}: {
  value: readonly (typeof EnvVarEnvironment.Type)[];
  onChange: (value: readonly (typeof EnvVarEnvironment.Type)[]) => void;
  disabled?: boolean;
}) => (
  <div className="flex flex-wrap gap-x-4 gap-y-2">
    {ENVIRONMENT_OPTIONS.map((option) => {
      const checked = value.includes(option.value);
      return (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2 text-sm select-none"
        >
          <Checkbox
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => {
              const nextValues = next
                ? [...value, option.value].filter(isEnvironment)
                : value.filter((env) => env !== option.value);
              onChange(nextValues);
            }}
          />
          {option.label}
        </label>
      );
    })}
  </div>
);
