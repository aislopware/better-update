import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";

import { oneLine, parseKinds } from "./list";

describe(parseKinds, () => {
  it.effect("defaults to both collections", () =>
    Effect.gen(function* () {
      expect(yield* parseKinds(undefined)).toStrictEqual(["screenshot", "crash"]);
      expect(yield* parseKinds(" ALL ")).toStrictEqual(["screenshot", "crash"]);
    }),
  );

  it.effect("narrows to a single collection", () =>
    Effect.gen(function* () {
      expect(yield* parseKinds("crash")).toStrictEqual(["crash"]);
      expect(yield* parseKinds("screenshot")).toStrictEqual(["screenshot"]);
    }),
  );

  it.effect("rejects prototype keys instead of letting them through", () =>
    Effect.gen(function* () {
      for (const raw of ["constructor", "__proto__", "valueOf", "nope"]) {
        const exit = yield* parseKinds(raw).pipe(Effect.exit);
        expect(Exit.isFailure(exit)).toBe(true);
      }
    }),
  );
});

describe(oneLine, () => {
  it("renders an em dash for absent or blank comments", () => {
    expect(oneLine(null)).toBe("—");
    expect(oneLine("   \n  ")).toBe("—");
  });

  it("collapses whitespace", () => {
    expect(oneLine("crashes on\n  launch\t\tevery time")).toBe("crashes on launch every time");
  });

  it("neutralises control characters that could rewrite the table", () => {
    const rendered = oneLine("\u001B[2K\rrewritten\u0008\u0008 row");
    expect(rendered).not.toContain("\u001B");
    expect(rendered).not.toContain("\u0008");
    expect(rendered).toBe("[2K rewritten row");
  });

  it("truncates on a grapheme boundary so emoji are never split", () => {
    const rendered = oneLine(`${"a".repeat(58)}😀 trailing text`);
    // 59 kept cells + the ellipsis; the emoji survives whole, not as a lone surrogate.
    expect(rendered).toBe(`${"a".repeat(58)}😀…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u.test(rendered)).toBe(false);
  });

  it("leaves a comment at the width untouched", () => {
    const exact = "b".repeat(60);
    expect(oneLine(exact)).toBe(exact);
  });
});
