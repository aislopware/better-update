// Hand-written, unlike its neighbours: Kumo's `Field` takes only the structured
// `{ message, match }` error shape, while the `Input` it wraps also accepts a
// bare string and normalizes it. Evening that out lets every call site hand over
// the string it already has — including the empty string that means "no error",
// which `exactOptionalPropertyTypes` otherwise makes awkward to spell in JSX.
import { Field as KumoField, normalizeFieldError } from "@cloudflare/kumo/components/field";

import type { FieldErrorMatch, FieldProps } from "@cloudflare/kumo/components/field";
import type { ReactNode } from "react";

export {
  KUMO_FIELD_DEFAULT_VARIANTS,
  KUMO_FIELD_VARIANTS,
  fieldVariants,
  normalizeFieldError,
} from "@cloudflare/kumo/components/field";
export type { FieldErrorMatch, FieldProps } from "@cloudflare/kumo/components/field";

interface Props extends Omit<FieldProps, "error"> {
  /** Message to show under the control. Falsy means the field is valid. */
  readonly error?: string | { message: ReactNode; match: FieldErrorMatch } | undefined;
}

export const Field = ({ error, children, ...props }: Props) => {
  // Spread rather than passed: `exactOptionalPropertyTypes` rejects an explicit
  // `undefined` for an optional prop declared without it, and "no error" is the
  // common case here.
  const normalized = normalizeFieldError(error);

  return (
    // eslint-disable-next-line react/jsx-props-no-spreading -- thin widening wrapper over Kumo's Field
    <KumoField {...props} {...(normalized ? { error: normalized } : {})}>
      {children}
    </KumoField>
  );
};
