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
  devicePixelRatio: 2,
  width: 1000,
  height: 1000,
  phi: 0,
  theta: 0.2,
  dark: dark ? 1 : 0,
  diffuse: dark ? 2.5 : 3,
  mapSamples: 40_000,
  mapBrightness: dark ? 2 : 1.5,
  baseColor: dark ? [0.1, 0.1, 0.12] : [1, 1, 1],
  markerColor: dark ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1],
  glowColor: dark ? [0.12, 0.12, 0.14] : [1, 1, 1],
  arcColor: dark ? [0.9, 0.9, 0.9] : [0.1, 0.1, 0.1],
  arcWidth: 0.35,
  arcHeight: 0.3,
  markerElevation: 0.02,
  markers: buildMarkers(),
  arcs: buildArcs(),
});

const readDark = (): boolean => document.documentElement.classList.contains("dark");

const POINTER_DAMPING = 300;

interface GlobeHandle {
  readonly globe: Globe;
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
    width: runtime.widthRef.current * 2,
    height: runtime.widthRef.current * 2,
  });

  const rafRef = { current: 0 };
  const step = () => {
    if (runtime.pointerRef.current === null && !runtime.reduce) {
      runtime.phiRef.current += 0.003;
    }
    globe.update({
      phi: runtime.phiRef.current + runtime.getSpringR(),
      width: runtime.widthRef.current * 2,
      height: runtime.widthRef.current * 2,
    });
    rafRef.current = globalThis.requestAnimationFrame(step);
  };
  rafRef.current = globalThis.requestAnimationFrame(step);

  return {
    globe,
    stop: () => {
      globalThis.cancelAnimationFrame(rafRef.current);
    },
  };
};

interface PointerState {
  readonly pointerRef: { current: number | null };
  readonly canvasRef: { current: HTMLCanvasElement | null };
  readonly springStart: (value: number) => void;
  readonly currentR: () => number;
}

const makePointerHandlers = (state: PointerState) => {
  const onDown = (clientX: number) => {
    state.pointerRef.current = clientX;
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

const edgeMarkerStyle = (id: string): CSSProperties =>
  ({
    positionAnchor: `--cobe-${id}`,
    top: "anchor(center)",
    left: "anchor(center)",
    transform: "translate(-50%, -50%)",
    opacity: `var(--cobe-visible-${id}, 0)`,
  }) as CSSProperties;

const edgeLabelStyle = (id: string): CSSProperties =>
  ({
    positionAnchor: `--cobe-${id}`,
    top: "anchor(bottom)",
    left: "anchor(center)",
    transform: "translate(-50%, 16px)",
    opacity: `var(--cobe-visible-${id}, 0)`,
  }) as CSSProperties;

const arcLabelStyle = (id: string): CSSProperties =>
  ({
    positionAnchor: `--cobe-arc-${id}`,
    top: "anchor(center)",
    left: "anchor(center)",
    transform: "translate(-50%, -50%)",
    opacity: `var(--cobe-visible-arc-${id}, 0)`,
  }) as CSSProperties;

export const HeroMotion = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phiRef = useRef(0);
  const widthRef = useRef(0);
  const pointerRef = useRef<number | null>(null);

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

    const darkRef = { current: readDark() };
    const handleRef = {
      current: startGlobe({
        canvas,
        phiRef,
        widthRef,
        pointerRef,
        getSpringR: () => rotation.get(),
        reduce,
        dark: darkRef.current,
      }),
    };

    const themeObserver = new MutationObserver(() => {
      const nextDark = readDark();
      if (nextDark === darkRef.current) {
        return;
      }
      darkRef.current = nextDark;
      handleRef.current.globe.destroy();
      handleRef.current.stop();
      handleRef.current = startGlobe({
        canvas,
        phiRef,
        widthRef,
        pointerRef,
        getSpringR: () => rotation.get(),
        reduce,
        dark: darkRef.current,
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      handleRef.current.globe.destroy();
      handleRef.current.stop();
      globalThis.removeEventListener("resize", onResize);
      themeObserver.disconnect();
    };
  });

  const { onDown, onUp, onMove } = makePointerHandlers({
    pointerRef,
    canvasRef,
    springStart: (value) => springApi.start({ rotation: value }),
    currentR: () => rotation.get(),
  });

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
      <div className="absolute top-[18%] right-[-8%] size-[520px] rounded-full bg-[radial-gradient(circle,oklch(0.65_0.22_275/0.12)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.24_275/0.22)_0%,transparent_65%)]" />
      <div className="absolute bottom-[-12%] left-[-10%] size-[440px] rounded-full bg-[radial-gradient(circle,oklch(0.7_0.16_220/0.14)_0%,transparent_65%)] blur-3xl dark:bg-[radial-gradient(circle,oklch(0.55_0.2_220/0.22)_0%,transparent_65%)]" />
      <div className="absolute inset-0 flex items-center justify-center lg:justify-end">
        <div className="pointer-events-auto relative aspect-square w-full max-w-[620px] translate-x-[18%] lg:max-w-[700px] lg:translate-x-[28%] xl:max-w-[780px] xl:translate-x-[30%] 2xl:max-w-[860px] 2xl:translate-x-[32%]">
          <canvas
            ref={canvasRef}
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
