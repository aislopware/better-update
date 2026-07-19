import { cellAlignClass, headerAlignsRight } from "./column-meta";

describe(cellAlignClass, () => {
  it("keeps legacy align/muted output unchanged", () => {
    expect(cellAlignClass(undefined)).toBe("");
    expect(cellAlignClass({})).toBe("");
    expect(cellAlignClass({ align: "right" })).toBe("text-right tabular-nums");
    expect(cellAlignClass({ align: "right", muted: true })).toBe(
      "text-right tabular-nums text-muted-foreground",
    );
  });

  it("maps typed cells to their presentation classes", () => {
    expect(cellAlignClass({ cellType: "id" })).toBe("font-mono text-xs text-muted-foreground");
    expect(cellAlignClass({ cellType: "date" })).toBe("text-muted-foreground");
    expect(cellAlignClass({ cellType: "numeric" })).toBe("text-right tabular-nums");
  });

  it("leaves renderer-driven cell types unstyled", () => {
    expect(cellAlignClass({ cellType: "text" })).toBe("");
    expect(cellAlignClass({ cellType: "status" })).toBe("");
    expect(cellAlignClass({ cellType: "link" })).toBe("");
  });
});

describe(headerAlignsRight, () => {
  it("right-aligns for explicit align and numeric cells only", () => {
    expect(headerAlignsRight(undefined)).toBe(false);
    expect(headerAlignsRight({})).toBe(false);
    expect(headerAlignsRight({ align: "right" })).toBe(true);
    expect(headerAlignsRight({ cellType: "numeric" })).toBe(true);
    expect(headerAlignsRight({ cellType: "id" })).toBe(false);
  });
});
