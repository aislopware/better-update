import { Checkbox } from "@better-update/ui/components/ui/checkbox";
import { CheckboxGroup } from "@better-update/ui/components/ui/checkbox-group";
import { Label } from "@better-update/ui/components/ui/label";

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
  <CheckboxGroup
    className="flex-row flex-wrap items-center gap-x-4 gap-y-2"
    value={[...value]}
    onValueChange={(next) => {
      onChange(next.filter(isEnvironment));
    }}
    disabled={disabled}
  >
    {ENVIRONMENT_OPTIONS.map((option) => (
      <Label key={option.value} className="cursor-pointer gap-2 text-sm select-none">
        <Checkbox name={option.value} />
        {option.label}
      </Label>
    ))}
  </CheckboxGroup>
);
