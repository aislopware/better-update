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
    z.regex(/^[A-Z][A-Z0-9_]*$/, "Must be uppercase letters, digits, and underscores"),
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
    z.regex(/^[a-z0-9-]+$/, "Only lowercase letters, numbers, and hyphens"),
  );

export const generateSlug = (name: string) =>
  name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
