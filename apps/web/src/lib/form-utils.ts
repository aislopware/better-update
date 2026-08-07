import { z } from "zod/v4";

export const nameSchema = z.string().check(z.minLength(2, "Name must be at least 2 characters"));

export const deviceNameSchema = z
  .string()
  .check(z.minLength(1, "Name is required"), z.maxLength(120, "Max 120 characters"));

export const requiredStringSchema = z.string().check(z.minLength(1, "This field is required"));

export const envVarKeySchema = z
  .string()
  .check(
    z.minLength(1, "Key is required"),
    z.maxLength(256, "Key must be at most 256 characters"),
    z.regex(/^[A-Z][A-Z0-9_]*$/u, "Must be uppercase letters, digits, and underscores"),
  );

export const passwordSchema = z
  .string()
  .check(z.minLength(8, "Password must be at least 8 characters"));

export const getFieldError = (field: { state: { meta: { errors: unknown[] } } }) =>
  field.state.meta.errors.map(String).filter(Boolean).join(", ");

export const slugSchema = z
  .string()
  .check(
    z.minLength(2, "Slug must be at least 2 characters"),
    z.maxLength(48, "Slug must be at most 48 characters"),
    z.regex(/^[a-z0-9-]+$/u, "Only lowercase letters, numbers, and hyphens"),
  );

/**
 * Normalize a nullable/optional string into a controlled-input value. Seeds an
 * edit form's React state from an existing entity field where absence maps to an
 * empty string. Written as an explicit comparison so it trips neither the
 * `no-restricted-syntax` empty-string-fallback rule nor
 * `prefer-logical-operator-over-ternary`.
 */
export const toInputValue = (value: string | null | undefined): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
};

/**
 * Adapt a Select's `onValueChange` to a handler that only wants a real value.
 *
 * Base UI reports `null` when a selection is cleared, but none of the pickers
 * here are clearable — there is no empty option and no clear affordance — so
 * every call site would otherwise open with the same null guard. `T` comes from
 * the handler, so an inline arrow has to annotate its parameter.
 */
export const onPicked =
  <T>(handle: (value: T) => void) =>
  (value: T | null): void => {
    if (value !== null) {
      handle(value);
    }
  };

export const generateSlug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
