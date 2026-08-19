import { Color, SRGBColorSpace } from "three";

/**
 * Kumo publishes its palette as `light-dark(oklch(…), oklch(…))`, which three's
 * `Color.setStyle` cannot parse — it only reads hex/rgb/hsl. Rather than
 * duplicating the tokens as hex (they would silently rot the next time Kumo
 * ships a palette change), resolve them the way the browser already can:
 * a probe element computes the *used* colour for the current theme, and a 1×1
 * 2D canvas rasterises whatever syntax that is into sRGB bytes.
 */

const scratch = { current: null as CanvasRenderingContext2D | null };

const scratchContext = (): CanvasRenderingContext2D | null => {
  if (scratch.current) {
    return scratch.current;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  scratch.current = canvas.getContext("2d", { willReadFrequently: true });
  return scratch.current;
};

const usedColor = (expression: string): string => {
  const probe = document.createElement("span");
  probe.style.color = expression;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  const used = globalThis.getComputedStyle(probe).color;
  probe.remove();
  return used;
};

export interface ThemeColor {
  readonly color: Color;
  /**
   * The token's own alpha. Several Kumo tokens are a near-black at low alpha
   * (`--color-kumo-line` in light mode is `oklch(0.145 0 0 / 0.1)`), so a caller
   * that only reads RGB would paint them solid black.
   */
  readonly alpha: number;
}

/**
 * Resolve a CSS colour expression (typically `var(--color-kumo-…)`) against the
 * document's current theme. `fallback` is a hex literal used when the token is
 * missing or the canvas rejects the syntax.
 */
export const readThemeColor = (expression: string, fallback: string): ThemeColor => {
  const context = scratchContext();
  const color = new Color();
  if (!context) {
    return { color: color.setStyle(fallback), alpha: 1 };
  }
  context.clearRect(0, 0, 1, 1);
  // Assigning an unparseable value to `fillStyle` is a no-op, so seeding it with
  // the fallback first means a rejected token degrades instead of painting black.
  context.fillStyle = fallback;
  context.fillStyle = usedColor(expression);
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  return {
    color: color.setRGB((red ?? 0) / 255, (green ?? 0) / 255, (blue ?? 0) / 255, SRGBColorSpace),
    alpha: (alpha ?? 255) / 255,
  };
};

export const isDarkTheme = (): boolean => document.documentElement.classList.contains("dark");
