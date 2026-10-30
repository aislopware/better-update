/**
 * Resolve a CLI-friendly device name to an apple-utils {@link AppleUtils.ScreenshotDisplayType}
 * / {@link AppleUtils.PreviewType}. App Store Connect names screenshot device
 * classes `APP_IPHONE_67` and preview classes `IPHONE_67`; the CLI and the
 * declarative `metadata media sync` directory tree accept the exact enum value
 * (case-insensitive) or a friendly alias without the `APP_` prefix
 * (`iphone-67`, `ipad-pro-3gen-129`, `apple-vision-pro`, `desktop`). Backs the
 * `metadata` (store media) command group.
 */
// @expo/apple-utils is ncc-bundled CJS; the `ScreenshotDisplayType`/`PreviewType`
// enums are read off the default import (see apple-asc-connect.ts for the rationale).
import AppleUtils from "@expo/apple-utils";
import { Effect } from "effect";

import { InvalidArgumentError } from "./exit-codes";

// `Object.values` on a string-enum yields its member values, widened to `string[]`
// here so membership checks compare string-to-string (no unsafe enum comparison).
const SCREENSHOT_DISPLAY_TYPES: readonly string[] = Object.values(AppleUtils.ScreenshotDisplayType);
const PREVIEW_TYPES: readonly string[] = Object.values(AppleUtils.PreviewType);

const isScreenshotDisplayType = (value: string): value is AppleUtils.ScreenshotDisplayType =>
  SCREENSHOT_DISPLAY_TYPES.includes(value);
const isPreviewType = (value: string): value is AppleUtils.PreviewType =>
  PREVIEW_TYPES.includes(value);

/** Normalize a device name to the enum's `UPPER_SNAKE` shape (`iphone-67` → `IPHONE_67`). */
const normalize = (raw: string): string => raw.trim().toUpperCase().replaceAll("-", "_");

/**
 * Resolve a `--device` flag (or a `media sync` directory name) to a
 * {@link AppleUtils.ScreenshotDisplayType}. Accepts the exact enum value
 * (`APP_IPHONE_67`, any case) or the alias without the `APP_` prefix (`iphone-67`).
 */
export const resolveScreenshotDisplayType = (
  raw: string,
): Effect.Effect<AppleUtils.ScreenshotDisplayType, InvalidArgumentError> => {
  const normalized = normalize(raw);
  const candidate = isScreenshotDisplayType(normalized) ? normalized : `APP_${normalized}`;
  if (isScreenshotDisplayType(candidate)) {
    return Effect.succeed(candidate);
  }
  return Effect.fail(
    new InvalidArgumentError({
      message: `Unknown screenshot device "${raw}". Examples: APP_IPHONE_67, iphone-67, ipad-pro-3gen-129, apple-vision-pro. Full list: ${SCREENSHOT_DISPLAY_TYPES.join(", ")}.`,
    }),
  );
};

/**
 * Resolve a `--device` flag to a {@link AppleUtils.PreviewType}. Accepts the exact
 * enum value (`IPHONE_67`, any case) or a `-`-separated alias (`iphone-67`).
 */
export const resolvePreviewType = (
  raw: string,
): Effect.Effect<AppleUtils.PreviewType, InvalidArgumentError> => {
  const normalized = normalize(raw);
  if (isPreviewType(normalized)) {
    return Effect.succeed(normalized);
  }
  return Effect.fail(
    new InvalidArgumentError({
      message: `Unknown preview device "${raw}". Examples: IPHONE_67, iphone-67, ipad-pro-3gen-129, apple-tv. Full list: ${PREVIEW_TYPES.join(", ")}.`,
    }),
  );
};
