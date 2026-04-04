import { z } from "zod/v4";

export const nameSchema = z.string().check(z.minLength(2, "Name must be at least 2 characters"));

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

export const generateScopeKey = (name: string) =>
  `@${name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")}/app`;
