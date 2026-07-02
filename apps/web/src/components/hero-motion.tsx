import { useMountEffect } from "@better-update/react-hooks";
import { useSpring } from "@react-spring/web";
import createGlobe from "cobe";
import { useRef } from "react";

import type { Arc, COBEOptions, Globe, Marker } from "cobe";
import type { CSSProperties } from "react";

import { BrandIcon } from "./brand-mark";

interface Edge {
  readonly id: string;
  readonly location: [number, number];
  readonly label: string;
}

const EDGES: readonly Edge[] = [
  { id: "iad", location: [39.04, -77.49], label: "iad" },
  { id: "sjc", location: [37.37, -121.92], label: "sjc" },
  { id: "dfw", location: [32.9, -97.04], label: "dfw" },
  { id: "mia", location: [25.79, -80.29], label: "mia" },
  { id: "gru", location: [-23.55, -46.63], label: "gru" },
  { id: "lhr", location: [51.47, -0.45], label: "lhr" },
  { id: "cdg", location: [49.01, 2.55], label: "cdg" },
  { id: "fra", location: [50.03, 8.56], label: "fra" },
  { id: "ams", location: [52.31, 4.76], label: "ams" },
  { id: "bom", location: [19.09, 72.87], label: "bom" },
  { id: "sin", location: [1.35, 103.82], label: "sin" },
  { id: "nrt", location: [35.76, 140.39], label: "nrt" },
  { id: "syd", location: [-33.95, 151.18], label: "syd" },
  { id: "jnb", location: [-26.14, 28.24], label: "jnb" },
];

interface ArcLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
}

const ARCS: readonly ArcLink[] = [
  { id: "iad-lhr", from: "iad", to: "lhr", label: "2.4 TB/s" },
  { id: "sjc-nrt", from: "sjc", to: "nrt", label: "1.8 TB/s" },
  { id: "lhr-sin", from: "lhr", to: "sin", label: "1.2 TB/s" },
  { id: "iad-gru", from: "iad", to: "gru", label: "890 GB/s" },
  { id: "fra-bom", from: "fra", to: "bom", label: "720 GB/s" },
  { id: "sin-syd", from: "sin", to: "syd", label: "540 GB/s" },
];

const EDGE_BY_ID: Readonly<Record<string, Edge>> = Object.fromEntries(
  EDGES.map((edge) => [edge.id, edge]),
);

const buildMarkers = (): Marker[] =>
  EDGES.map(
    (edge): Marker => ({
      id: edge.id,
      location: [edge.location[0], edge.location[1]],
      size: 0,
    }),
  );

const buildArcs = (): Arc[] =>
  ARCS.flatMap((arc): Arc[] => {
    const from = EDGE_BY_ID[arc.from];
    const to = EDGE_BY_ID[arc.to];
    if (!from || !to) {
      return [];
    }
    return [
      {
        id: arc.id,
        from: [from.location[0], from.location[1]],
        to: [to.location[0], to.location[1]],
      },
    ];
  });

const buildConfig = (dark: boolean): COBEOptions => ({
  // Cap at 2: the canvas already renders at the CSS size, so a higher ratio only
  // multiplies fragment-shader work (pixels = width * dpr) with no visible gain.
  devicePixelRatio: Math.min(globalThis.devicePixelRatio, 2),
  width: 1000,
  height: 1000,
  phi: 0,
  theta: 0.2,
  dark: dark ? 1 : 0,
  diffuse: dark ? 2.5 : 3,
  mapSamples: 16_000,
  mapBrightness: dark ? 2 : 1.5,
  baseColor: dark ? [0.1, 0.1, 0.12] : [1, 1, 1],
  markerColor: dark ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1],
  glowColor: dark ? [0.12, 0.12, 0.14] : [1, 1, 1],
  arcColor: dark ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1],
  arcWidth: 0.35,
  arcHeight: 0.3,
  markerElevation: 0.02,
  // Disable MSAA: the sphere edge is already shader-antialiased, and skipping it
  // cuts GPU load noticeably on integrated GPUs (cobe#44). alpha stays on for glow.
  context: { antialias: false },
  markers: buildMarkers(),
  arcs: buildArcs(),
});

const readDark = (): boolean => document.documentElement.classList.contains("dark");

const POINTER_DAMPING = 300;

// Cap the globe's render rate. Each rendered frame forces a full layout + style
// recalc (cobe positions the HTML markers/labels via CSS anchors), so on a 120Hz
// display the uncapped rAF loop ran ~120 layouts/s. 30fps stays smooth enough for
// a decorative globe while cutting that per-frame work ~4x.
const TARGET_FRAME_MS = 1000 / 30;
// Auto-rotation speed in radians/ms (≈0.18 rad/s — was 0.003 rad/frame tuned at
// 60Hz). Time-based so the speed is identical regardless of the display refresh
// rate, instead of spinning twice as fast on a 120Hz screen.
const ROTATION_PER_MS = 0.18 / 1000;

interface GlobeHandle {
  readonly globe: Globe;
  readonly start: () => void;
  readonly stop: () => void;
}

interface StartRuntime {
  readonly canvas: HTMLCanvasElement;
  readonly phiRef: { current: number };
  readonly widthRef: { current: number };
  readonly pointerRef: { current: number | null };
  readonly getSpringR: () => number;
  readonly reduce: boolean;
  readonly dark: boolean;
}

const startGlobe = (runtime: StartRuntime): GlobeHandle => {
  const globe = createGlobe(runtime.canvas, {
    ...buildConfig(runtime.dark),
    width: runtime.widthRef.current,
    height: runtime.widthRef.current,
  });

  const rafRef = { current: 0 };
  const timerRef = { current: undefined as ReturnType<typeof globalThis.setTimeout> | undefined };
  const runningRef = { current: false };
  const lastPhiRef = { current: Number.NaN };
  const lastTsRef = { current: 0 };

  const tick = (now: number) => {
    // Time-based so rotation speed is identical at any refresh rate; clamp the
    // delta so a long pause (backgrounded tab) doesn't jump the globe forward.
    const elapsed = lastTsRef.current === 0 ? TARGET_FRAME_MS : now - lastTsRef.current;
    const dt = Math.min(elapsed, TARGET_FRAME_MS * 4);
    lastTsRef.current = now;

    if (runtime.pointerRef.current === null && !runtime.reduce) {
      runtime.phiRef.current += ROTATION_PER_MS * dt;
    }
    const phi = runtime.phiRef.current + runtime.getSpringR();
    globe.update({
      phi,
      width: runtime.widthRef.current,
      height: runtime.widthRef.current,
    });

    // Keep going only while something is still in motion: auto-rotation, an
    // active drag, or a spring that has not settled. A static globe (e.g.
    // prefers-reduced-motion, idle) renders its final frame and then stops.
    const moving =
      !runtime.reduce || runtime.pointerRef.current !== null || phi !== lastPhiRef.current;
    lastPhiRef.current = phi;

    if (!moving) {
      runningRef.current = false;
      return;
    }
    // Wake on a timer, *then* paint on the next vsync — so a rAF callback is not
    // pending on every 120Hz refresh. A standing rAF makes Chrome recalc style
    // every frame while CSS transitions are on the page (crbug.com/1252311), so
    // gating keeps style-recalc + the anchor-driven layout at ~30/s, not ~120/s.
    timerRef.current = globalThis.setTimeout(() => {
      rafRef.current = globalThis.requestAnimationFrame(tick);
    }, TARGET_FRAME_MS);
  };

  return {
    globe,
    start: () => {
      if (runningRef.current) {
        return;
      }
      runningRef.current = true;
      rafRef.current = globalThis.requestAnimationFrame(tick);
    },
    stop: () => {
      runningRef.current = false;
      globalThis.cancelAnimationFrame(rafRef.current);
      globalThis.clearTimeout(timerRef.current);
    },
  };
};

interface PointerState {
  readonly pointerRef: { current: number | null };
  readonly canvasRef: { current: HTMLCanvasElement | null };
  readonly springStart: (value: number) => void;
  readonly currentR: () => number;
  readonly wake: () => void;
}

const makePointerHandlers = (state: PointerState) => {
  const onDown = (clientX: number) => {
    state.pointerRef.current = clientX;
    // Restart the loop in case it had idled (reduced motion / settled spring).
    state.wake();
    if (state.canvasRef.current) {
      state.canvasRef.current.style.cursor = "grabbing";
    }
  };

  const onUp = () => {
    state.pointerRef.current = null;
    if (state.canvasRef.current) {
      state.canvasRef.current.style.cursor = "grab";
    }
  };

  const onMove = (clientX: number) => {
    if (state.pointerRef.current === null) {
      return;
    }
    const delta = clientX - state.pointerRef.current;
    state.pointerRef.current = clientX;
    state.springStart(state.currentR() + delta / POINTER_DAMPING);
  };

  return { onDown, onUp, onMove };
};

const edgeMarkerStyle = (id: string): CSSProperties => ({
  positionAnchor: `--cobe-${id}`,
  top: "anchor(center)",
  left: "anchor(center)",
  transform: "translate(-50%, -50%)",
  opacity: `var(--cobe-visible-${id}, 0)`,
});

const edgeLabelStyle = (id: string): CSSProperties => ({
  positionAnchor: `--cobe-${id}`,
  top: "anchor(bottom)",
  left: "anchor(center)",
  transform: "translate(-50%, 16px)",
  opacity: `var(--cobe-visible-${id}, 0)`,
});

const arcLabelStyle = (id: string): CSSProperties => ({
  positionAnchor: `--cobe-arc-${id}`,
  top: "anchor(center)",
  left: "anchor(center)",
  transform: "translate(-50%, -50%)",
  opacity: `var(--cobe-visible-arc-${id}, 0)`,
});

export const HeroMotion = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const widthRef = useRef(0);
  const pointerRef = useRef<number | null>(null);
  const wakeRef = useRef<() => void>(() => undefined);

  const [{ rotation }, springApi] = useSpring(() => ({
    rotation: 0,
    config: { mass: 1, tension: 280, friction: 40, precision: 0.001 },
  }));

  useMountEffect(() => {
    const canvas = canvasRef.current;
    const noop = () => undefined;
    if (!canvas) {
      return noop;
    }

    const onResize = () => {
      widthRef.current = canvas.offsetWidth;
    };
    globalThis.addEventListener("resize", onResize);
    onResize();

    const reduce = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const makeHandle = (dark: boolean): GlobeHandle =>
      startGlobe({
        canvas,
        phiRef,
        widthRef,
        pointerRef,
        getSpringR: () => rotation.get(),
        reduce,
        dark,
      });

    const darkRef = { current: readDark() };
    const visibleRef = { current: true };
    const handleRef = { current: makeHandle(darkRef.current) };
    handleRef.current.start();
    wakeRef.current = () => {
      handleRef.current.start();
    };

    // Pause the render loop while the globe is scrolled out of view so it stops
    // burning frames off-screen, and resume it when it scrolls back in.
    const visibilityObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (!entry) {
        return;
      }
      visibleRef.current = entry.isIntersecting;
      if (entry.isIntersecting) {
        handleRef.current.start();
      } else {
        handleRef.current.stop();
      }
    });
    visibilityObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      const nextDark = readDark();
      if (nextDark === darkRef.current) {
        return;
      }
      darkRef.current = nextDark;
      handleRef.current.globe.destroy();
      handleRef.current.stop();
      handleRef.current = makeHandle(darkRef.current);
      wakeRef.current = () => {
        handleRef.current.start();
      };
      if (visibleRef.current) {
        handleRef.current.start();
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      handleRef.current.globe.destroy();
      handleRef.current.stop();
      wakeRef.current = noop;
      globalThis.removeEventListener("resize", onResize);
      themeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  });

  const { onDown, onUp, onMove } = makePointerHandlers({
    pointerRef,
    canvasRef,
    springStart: (value) => springApi.start({ rotation: value }),
    currentR: () => rotation.get(),
    wake: () => {
      wakeRef.current();
    },
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
      <div className="absolute top-[18%] right-[-8%] size-[520px] rounded-full bg-[radial-gradient(circle,oklch(0.65_0.22_275/0.12)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.24_275/0.22)_0%,transparent_65%)]" />
      <div className="absolute bottom-[-12%] left-[-10%] size-[440px] rounded-full bg-[radial-gradient(circle,oklch(0.7_0.16_220/0.14)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.2_220/0.22)_0%,transparent_65%)]" />
      <div className="absolute inset-0 flex items-center justify-center lg:justify-end">
        <div className="pointer-events-auto relative aspect-square w-full max-w-[620px] translate-x-[18%] lg:max-w-[700px] lg:translate-x-[28%] xl:max-w-[780px] xl:translate-x-[30%] 2xl:max-w-[860px] 2xl:translate-x-[32%]">
          <canvas
            ref={canvasRef}
            aria-label="Decorative hero animation"
            onPointerDown={(event) => {
              onDown(event.clientX);
            }}
            onPointerUp={onUp}
            onPointerOut={onUp}
            onMouseMove={(event) => {
              onMove(event.clientX);
            }}
            onTouchStart={(event) => {
              if (event.touches[0]) {
                onDown(event.touches[0].clientX);
              }
            }}
            onTouchEnd={onUp}
            onTouchMove={(event) => {
              if (event.touches[0]) {
                onMove(event.touches[0].clientX);
              }
            }}
            className="size-full cursor-grab opacity-100 transition-opacity duration-500 ease-out [contain:layout_paint_size] starting:opacity-0"
          />
          {EDGES.map((edge) => (
            <span
              key={`marker-${edge.id}`}
              className="pointer-events-none absolute transition-opacity duration-300 ease-out"
              style={edgeMarkerStyle(edge.id)}
            >
              <BrandIcon size={22} className="text-foreground" />
            </span>
          ))}
          {EDGES.map((edge) => (
            <span
              key={`label-${edge.id}`}
              className="bg-background text-foreground ring-border/60 pointer-events-none absolute rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap shadow-sm ring-1 transition-opacity duration-300 ease-out"
              style={edgeLabelStyle(edge.id)}
            >
              {edge.label}
            </span>
          ))}
          {ARCS.map((arc) => (
            <span
              key={arc.id}
              className="bg-foreground text-background pointer-events-none absolute rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none whitespace-nowrap shadow-sm transition-opacity duration-300 ease-out"
              style={arcLabelStyle(arc.id)}
            >
              {arc.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
