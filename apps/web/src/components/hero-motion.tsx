import { useMountEffect } from "@better-update/react-hooks";
import { useRef } from "react";

import { BrandBackdrop, BrandIcon } from "./brand-mark";
import { EDGES } from "./hero-globe/network";

import type { Caption } from "./hero-globe/network";
import type { HeroGlobeHandle } from "./hero-globe/scene";

/** Land-point cloud, vendored into `public/`. ~94 KB, fetched once and cached. */
const LAND_POINTS_URL = "/earth-land-points.bin";

/** Pixels of horizontal drag per radian of rotation. */
const DRAG_DAMPING = 260;
/** Decay of the flick that follows a release, per 60 fps frame's worth of time. */
const DRAG_FRICTION = 0.92;
const FRICTION_REFERENCE_MS = 1000 / 60;
/** Clamp long frame gaps (backgrounded tab) so the globe never jumps on return. */
const MAX_FRAME_MS = 100;

const noop = () => undefined;

/**
 * The four corner brackets drawn over the card's dashed border — two 2px bars
 * per corner, pulled out by half a pixel so they sit on the border, not inside
 * it. Written out rather than generated because Tailwind's scanner only sees
 * class names that appear literally in the source.
 */
const CORNER_BRACKETS = [
  "top-[-1.5px] left-[-1.5px] h-[2px] w-4",
  "top-[-1.5px] left-[-1.5px] h-4 w-[2px]",
  "top-[-1.5px] right-[-1.5px] h-[2px] w-4",
  "top-[-1.5px] right-[-1.5px] h-4 w-[2px]",
  "bottom-[-1.5px] left-[-1.5px] h-[2px] w-4",
  "bottom-[-1.5px] left-[-1.5px] h-4 w-[2px]",
  "bottom-[-1.5px] right-[-1.5px] h-[2px] w-4",
  "bottom-[-1.5px] right-[-1.5px] h-4 w-[2px]",
];

/**
 * Where a card sits relative to its marker, and when it is allowed to show.
 * The scene writes `data-side` onto the marker root every frame; a card grows
 * in only while its city is on the left of the globe, which is the half of the
 * hero the sign-in panel does not cover.
 */
const CARD_PLACEMENT = {
  above:
    "origin-bottom-right translate-y-[calc(-100%-26px)] group-data-[side=left]:scale-100 group-data-[side=left]:opacity-100",
  below:
    "origin-top-right translate-y-[26px] group-data-[side=left]:scale-100 group-data-[side=left]:opacity-100",
};

const CaptionCard = ({ caption }: { readonly caption: Caption }) => (
  <div
    className={`text-kumo-subtle dark:text-kumo-default bg-kumo-canvas/80 absolute top-0 left-0 z-10 w-[200px] translate-x-[-240px] scale-0 border border-dashed border-current/60 p-3 opacity-0 backdrop-blur-sm transition-[opacity,transform] duration-200 ease-out max-lg:hidden ${CARD_PLACEMENT[caption.place]}`}
  >
    <p className="text-kumo-strong text-sm leading-none font-medium">{caption.value}</p>
    <p className="text-kumo-subtle mt-2 text-xs leading-snug">{caption.text}</p>
    {CORNER_BRACKETS.map((bracket) => (
      <span key={bracket} className={`pointer-events-none absolute bg-current ${bracket}`} />
    ))}
  </div>
);

interface Runtime {
  handle: HeroGlobeHandle | null;
  raf: number;
  last: number;
  velocity: number;
  dragX: number | null;
  disposed: boolean;
}

const loadLandPoints = async (): Promise<Int16Array> => {
  const response = await fetch(LAND_POINTS_URL);
  return new Int16Array(await response.arrayBuffer());
};

/**
 * Decorative hero globe: a point cloud of the world's land mass with the edge
 * network drawn over it, ported from the "Region: Earth" scene on
 * cloudflare.com and recoloured onto Kumo's neutral foreground tokens.
 *
 * three.js is loaded on demand from inside the mount effect — it must not sit
 * in the SSR bundle or the login route's initial payload for a decoration.
 */
export const HeroMotion = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const anchorsRef = useRef(new Map<string, HTMLElement>());
  const runtimeRef = useRef<Runtime>({
    handle: null,
    raf: 0,
    last: 0,
    velocity: 0,
    dragX: null,
    disposed: false,
  });

  useMountEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) {
      return noop;
    }
    const runtime = runtimeRef.current;
    // The runtime object outlives the effect (it lives in a ref), so a remount —
    // React 19 StrictMode mounts, tears down, then mounts again — would otherwise
    // find `disposed` still set from the first teardown and abandon the boot.
    runtime.disposed = false;
    const reduceMotion = globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Every `requestAnimationFrame` callback draws — the globe is smoothest when
    // it is in lockstep with the display, and dropping callbacks to halve the
    // rate reads as judder on a drag. The frame's own cost is what was made
    // cheap instead: one draw call for the wireframe, no per-frame allocation,
    // DOM writes only when a marker actually moves, and no work at all once the
    // scene has settled.
    const tick = (now: number) => {
      const { handle } = runtime;
      if (!handle) {
        return;
      }
      runtime.raf = globalThis.requestAnimationFrame(tick);
      const elapsed = runtime.last === 0 ? FRICTION_REFERENCE_MS : now - runtime.last;
      runtime.last = now;
      const delta = Math.min(elapsed, MAX_FRAME_MS);
      if (runtime.dragX === null && runtime.velocity !== 0) {
        handle.nudge(runtime.velocity);
        runtime.velocity =
          Math.abs(runtime.velocity) < 1e-5
            ? 0
            : runtime.velocity * DRAG_FRICTION ** (delta / FRICTION_REFERENCE_MS);
      }
      handle.frame(delta);
    };

    const start = () => {
      if (runtime.raf !== 0 || !runtime.handle) {
        return;
      }
      runtime.last = 0;
      runtime.raf = globalThis.requestAnimationFrame(tick);
    };

    const stop = () => {
      globalThis.cancelAnimationFrame(runtime.raf);
      runtime.raf = 0;
    };

    const boot = async () => {
      const [{ createHeroGlobe }, landPoints] = await Promise.all([
        import("./hero-globe/scene"),
        loadLandPoints(),
      ]);
      if (runtime.disposed) {
        return;
      }
      runtime.handle = createHeroGlobe({
        canvas,
        landPoints,
        anchors: anchorsRef.current,
        reduceMotion,
      });
      runtime.handle.resize(container.offsetWidth, container.offsetHeight);
      canvas.style.opacity = "1";
      start();
    };
    // Fire-and-forget: a globe that fails to load must degrade to an empty
    // backdrop, not an unhandled rejection.
    boot().catch(noop);

    const resizeObserver = new ResizeObserver(() => {
      runtime.handle?.resize(container.offsetWidth, container.offsetHeight);
    });
    resizeObserver.observe(container);

    // Off-screen frames are wasted GPU and battery — the globe only runs while
    // some part of it is on screen.
    const visibilityObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (entry?.isIntersecting) {
        start();
      } else {
        stop();
      }
    });
    visibilityObserver.observe(canvas);

    const themeObserver = new MutationObserver(() => {
      runtime.handle?.retheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      runtime.disposed = true;
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      themeObserver.disconnect();
      runtime.handle?.dispose();
      runtime.handle = null;
    };
  });

  const registerAnchor = (id: string) => (element: HTMLDivElement | null) => {
    if (element) {
      anchorsRef.current.set(id, element);
    } else {
      anchorsRef.current.delete(id);
    }
  };

  const onDown = (clientX: number) => {
    runtimeRef.current.dragX = clientX;
    runtimeRef.current.velocity = 0;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grabbing";
    }
  };

  const onUp = () => {
    runtimeRef.current.dragX = null;
    if (canvasRef.current) {
      canvasRef.current.style.cursor = "grab";
    }
  };

  const onMove = (clientX: number) => {
    const runtime = runtimeRef.current;
    if (runtime.dragX === null || !runtime.handle) {
      return;
    }
    const delta = (clientX - runtime.dragX) / DRAG_DAMPING;
    runtime.dragX = clientX;
    runtime.velocity = delta;
    runtime.handle.nudge(delta);
  };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 select-none">
      <BrandBackdrop />
      <div className="absolute inset-0 flex items-center justify-center lg:justify-end">
        <div
          ref={containerRef}
          className="pointer-events-auto relative aspect-square w-full max-w-[620px] translate-x-[18%] lg:max-w-[700px] lg:translate-x-[28%] xl:max-w-[780px] xl:translate-x-[30%] 2xl:max-w-[860px] 2xl:translate-x-[32%]"
        >
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
            className="size-full cursor-grab opacity-0 transition-opacity duration-700 ease-out [contain:layout_paint_size]"
          />
          {EDGES.map((edge) => (
            <div
              key={edge.id}
              ref={registerAnchor(edge.id)}
              data-side="right"
              className="group pointer-events-none absolute top-0 left-0 opacity-0 transition-opacity duration-300 ease-out will-change-transform"
            >
              <span className="text-kumo-subtle dark:text-kumo-default bg-kumo-canvas/50 absolute top-0 left-0 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-current/70 backdrop-blur-sm">
                <BrandIcon size={15} />
              </span>
              {edge.caption ? <CaptionCard caption={edge.caption} /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
