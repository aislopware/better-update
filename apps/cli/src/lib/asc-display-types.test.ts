import { Effect, Exit } from "effect";

import { resolvePreviewType, resolveScreenshotDisplayType } from "./asc-display-types";

const run = <Value, Err>(effect: Effect.Effect<Value, Err>): Exit.Exit<Value, Err> =>
  Effect.runSyncExit(effect);

describe(resolveScreenshotDisplayType, () => {
  it("accepts the exact enum value case-insensitively", () => {
    expect(run(resolveScreenshotDisplayType("APP_IPHONE_67"))).toStrictEqual(
      Exit.succeed("APP_IPHONE_67"),
    );
    expect(run(resolveScreenshotDisplayType("app_iphone_67"))).toStrictEqual(
      Exit.succeed("APP_IPHONE_67"),
    );
  });

  it("accepts the friendly alias without the APP_ prefix", () => {
    expect(run(resolveScreenshotDisplayType("iphone-67"))).toStrictEqual(
      Exit.succeed("APP_IPHONE_67"),
    );
    expect(run(resolveScreenshotDisplayType("ipad-pro-3gen-129"))).toStrictEqual(
      Exit.succeed("APP_IPAD_PRO_3GEN_129"),
    );
    expect(run(resolveScreenshotDisplayType("apple-vision-pro"))).toStrictEqual(
      Exit.succeed("APP_APPLE_VISION_PRO"),
    );
    expect(run(resolveScreenshotDisplayType("desktop"))).toStrictEqual(Exit.succeed("APP_DESKTOP"));
  });

  it("keeps the IMESSAGE_ family addressable by its exact value", () => {
    expect(run(resolveScreenshotDisplayType("imessage-app-iphone-67"))).toStrictEqual(
      Exit.succeed("IMESSAGE_APP_IPHONE_67"),
    );
  });

  it("fails on an unknown device", () => {
    const exit = run(resolveScreenshotDisplayType("nokia-3310"));
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe(resolvePreviewType, () => {
  it("accepts the exact enum value and the alias (no APP_ prefix on previews)", () => {
    expect(run(resolvePreviewType("IPHONE_67"))).toStrictEqual(Exit.succeed("IPHONE_67"));
    expect(run(resolvePreviewType("iphone-67"))).toStrictEqual(Exit.succeed("IPHONE_67"));
    expect(run(resolvePreviewType("apple-tv"))).toStrictEqual(Exit.succeed("APPLE_TV"));
  });

  it("does not accept the screenshot APP_ prefix", () => {
    expect(Exit.isFailure(run(resolvePreviewType("APP_IPHONE_67")))).toBe(true);
  });
});
