/* eslint-disable promise/prefer-await-to-then -- zod's .catch() is a sync schema fallback, not a Promise handler */
import { z } from "zod";

export const pageParam = () => z.coerce.number().int().min(1).catch(1).default(1);

export const sortParam = (defaultSort: string) =>
  z.string().catch(defaultSort).default(defaultSort);

export const queryParam = () => z.string().catch("").default("");

export const optionalStringParam = () => z.string().optional().catch(undefined);

export const optionalEnumParam = <T extends string>(values: readonly [T, ...T[]]) =>
  z.enum(values).optional().catch(undefined);

export const enumParam = <T extends string>(values: readonly [T, ...T[]], defaultValue: T) =>
  z.enum(values).catch(defaultValue).default(defaultValue);

/**
 * A free-form string-array search param (no fixed enum). For filters whose set is
 * dynamic (e.g. user-defined environments); an empty array means "no filter".
 */
export const freeStringArrayParam = () => z.array(z.string()).catch([]).default([]);
