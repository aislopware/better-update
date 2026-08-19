import {
  Color,
  DoubleSide,
  Fog,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  Scene,
  TubeGeometry,
  Vector3,
  WebGLRenderer,
} from "three";

import type { InstancedMesh, ShapeGeometry } from "three";

import {
  createGraticule,
  createLandPoints,
  createLinkCurve,
  GLOBE_RADIUS,
  latLonToVector,
} from "./geometry";
import { EDGE_BY_ID, EDGES, LINKS } from "./network";
import { isDarkTheme, readThemeColor } from "./theme";

import type { Graticule } from "./geometry";

/** Globe scale and camera framing. Distance is chosen so the sphere fits a square viewport. */
const GLOBE_SCALE = 1.2;
const CAMERA_FOV = 45;
const CAMERA_DISTANCE = 3.3;
/** Axial tilt, applied in world space so it stays pinned to the screen as the camera orbits. */
const GLOBE_TILT = -0.25;
/**
 * Depth cue: the far hemisphere dissolves into the page background instead of
 * showing through as a second, mirrored continent map.
 */
const FOG_NEAR = CAMERA_DISTANCE - 0.8;
const FOG_FAR = CAMERA_DISTANCE + 1.2;

/** Radians per millisecond — a slow drift, not a spin. */
const ROTATION_PER_MS = 0.08 / 1000;

/** A marker fades in past this facing threshold and only fades out below the second. */
const FACING_ENTER = 0.12;
const FACING_EXIT = 0.02;

/**
 * Movement below this is finer than `transform` is written to anyway, so it
 * costs a style recalculation for nothing. Small enough that a turning globe
 * always clears it — the skip is for the settled scene, not the moving one.
 */
const POSITION_EPSILON = 0.005;

const LINK_TUBE_RADIUS = 0.002;
const LINK_TUBE_SEGMENTS = 64;
const LINK_TUBE_SIDES = 6;
/** Seconds a link takes to draw itself in, and the shorter time it takes to retract. */
const LINK_GROW_SECONDS = 1.5;
const LINK_SHRINK_SECONDS = 0.55;
const LINK_OPACITY = 0.8;

/**
 * The wireframe is a whisper, not a cage. Multiplied by the line token's own
 * alpha: in dark mode the token is an opaque dark grey that needs holding back,
 * in light mode it already carries a 10% alpha and can be used as it comes.
 */
const GRATICULE_DARK_STRENGTH = 0.55;
const GRATICULE_LIGHT_STRENGTH = 1;

/**
 * The globe is monochrome, not branded: a quiet grey on the light canvas and a
 * near-white on the dark one. Brand blue made a decoration shout louder than
 * the sign-in panel beside it, and `subtle` on light stops short of the flat
 * black that a 16k-point cloud turns into a smudge at. The overlay's markers
 * and cards follow the same two tokens through `dark:` variants, so the whole
 * hero flips as a piece.
 *
 * Kumo namespaces its colour tokens per property — the foreground role is
 * `--text-color-kumo-*`, not `--color-kumo-*` (which is the surface scale).
 */
const ACCENT_LIGHT_COLOR = "var(--text-color-kumo-subtle)";
const ACCENT_LIGHT_FALLBACK = "#737373";
const ACCENT_DARK_COLOR = "var(--text-color-kumo-default)";
const ACCENT_DARK_FALLBACK = "#f5f5f5";
const LINE_COLOR = "var(--color-kumo-line)";
const LINE_FALLBACK = "#8a8a8a";
const CANVAS_COLOR = "var(--color-kumo-canvas)";
const CANVAS_FALLBACK = "#0b0b0d";

const easeOutCubic = (ratio: number): number => 1 - (1 - ratio) ** 3;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
/** Draw ranges must land on whole triangles. */
const toTriangle = (value: number): number => Math.floor(value / 3) * 3;

interface LinkView {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly mesh: Mesh<TubeGeometry, MeshBasicMaterial>;
  readonly material: MeshBasicMaterial;
  readonly progress: { start: number; end: number };
}

export interface HeroGlobeOptions {
  readonly canvas: HTMLCanvasElement;
  readonly landPoints: Int16Array;
  /** Overlay roots keyed by edge id. React owns the map; the scene only reads it. */
  readonly anchors: ReadonlyMap<string, HTMLElement>;
  readonly reduceMotion: boolean;
}

export interface HeroGlobeHandle {
  readonly resize: (width: number, height: number) => void;
  readonly frame: (deltaMs: number) => void;
  readonly nudge: (deltaRadians: number) => void;
  readonly retheme: () => void;
  readonly dispose: () => void;
}

/** Reused across every marker of every frame — projecting into a fresh `Vector3` allocated ~840 of them a second. */
const scratchPoint = new Vector3();
const scratchNormal = new Vector3();
const scratchToCamera = new Vector3();
const scratchProjected = new Vector3();

/** Builds one tube per link, pushing its material into `materials` for theming. */
const buildLinks = (materials: MeshBasicMaterial[]): LinkView[] =>
  LINKS.flatMap((link): LinkView[] => {
    const from = EDGE_BY_ID.get(link.from);
    const to = EDGE_BY_ID.get(link.to);
    if (!from || !to) {
      return [];
    }
    const curve = createLinkCurve(
      latLonToVector(from.lat, from.lon, GLOBE_RADIUS),
      latLonToVector(to.lat, to.lon, GLOBE_RADIUS),
    );
    const geometry = new TubeGeometry(
      curve,
      LINK_TUBE_SEGMENTS,
      LINK_TUBE_RADIUS,
      LINK_TUBE_SIDES,
      false,
    );
    geometry.setDrawRange(0, 0);
    const linkMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    materials.push(linkMaterial);
    const mesh = new Mesh<TubeGeometry, MeshBasicMaterial>(geometry, linkMaterial);
    mesh.visible = false;
    mesh.renderOrder = 5000;
    mesh.raycast = () => undefined;
    return [
      {
        id: link.id,
        from: link.from,
        to: link.to,
        mesh,
        material: linkMaterial,
        progress: { start: 0, end: 0 },
      },
    ];
  });

/**
 * Advance one link's draw range. The tube grows from its start vertex and
 * retracts from whichever end lost visibility, so a link never blinks out.
 * Returns whether the link actually moved — a scene where nothing moved does
 * not need to be drawn again.
 */
const stepLink = (link: LinkView, active: boolean, deltaSeconds: number): boolean => {
  const before = link.progress.start + link.progress.end;
  const step = deltaSeconds / (active ? LINK_GROW_SECONDS : LINK_SHRINK_SECONDS);
  if (active) {
    link.progress.start = clamp01(link.progress.start - step);
    link.progress.end = clamp01(link.progress.end + step);
  } else {
    link.progress.end = clamp01(Math.max(link.progress.start, link.progress.end - step));
  }
  const start = easeOutCubic(link.progress.start);
  const end = easeOutCubic(link.progress.end);
  const total = link.mesh.geometry.index?.count ?? 0;
  const first = toTriangle(total * start);
  const last = toTriangle(total * end);
  const drawn = end - start <= 0 ? 0 : Math.max(6, last - first);
  link.mesh.geometry.setDrawRange(first, drawn);
  link.mesh.visible = drawn > 0;
  link.material.opacity = Math.max(0, end - start) * LINK_OPACITY;
  return link.progress.start + link.progress.end !== before;
};

interface AnchorState {
  readonly left: number;
  readonly top: number;
  readonly visible: boolean;
  /** Which half of the viewport the marker sits on — the overlay hangs its caption card away from the globe. */
  readonly side: "left" | "right";
}

/** Last values actually written to an anchor, so a still frame writes nothing. */
interface AnchorWrites {
  left: number;
  top: number;
  visible: boolean;
  side: string;
}

/**
 * Every style write here costs a style recalculation on an element the
 * compositor is already animating, so each property is written only when it
 * changed. Positions stay sub-pixel: the canvas underneath draws the globe at
 * full precision, so snapping the markers to whole pixels made them step 1px
 * at a time against a surface that was sliding smoothly.
 */
const placeAnchor = (element: HTMLElement, state: AnchorState, written: AnchorWrites) => {
  if (
    Math.abs(state.left - written.left) > POSITION_EPSILON ||
    Math.abs(state.top - written.top) > POSITION_EPSILON ||
    Number.isNaN(written.left)
  ) {
    element.style.transform = `translate3d(${state.left.toFixed(2)}px, ${state.top.toFixed(2)}px, 0)`;
    written.left = state.left;
    written.top = state.top;
  }
  if (state.visible !== written.visible) {
    element.style.opacity = state.visible ? "1" : "0";
    written.visible = state.visible;
  }
  if (state.side !== written.side) {
    // Bracketed because `dataset` is an index signature and the app compiles
    // with `noPropertyAccessFromIndexSignature`.
    element.dataset["side"] = state.side;
    written.side = state.side;
  }
};

const createRenderer = (canvas: HTMLCanvasElement): WebGLRenderer => {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.toneMapping = NoToneMapping;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
  return renderer;
};

/** The three materials the whole scene shares, so a theme flip is three writes. */
interface Palette {
  readonly point: MeshBasicMaterial;
  readonly line: LineBasicMaterial;
  readonly links: MeshBasicMaterial[];
}

const createPalette = (): Palette => ({
  point: new MeshBasicMaterial({ side: DoubleSide, transparent: true }),
  line: new LineBasicMaterial({ transparent: true }),
  links: [],
});

interface GlobeParts {
  readonly group: Group;
  readonly landPoints: InstancedMesh<ShapeGeometry, MeshBasicMaterial>;
  readonly graticule: Graticule;
}

const createGlobeGroup = (
  landData: Int16Array,
  palette: Palette,
  links: readonly LinkView[],
): GlobeParts => {
  const group = new Group();
  group.scale.setScalar(GLOBE_SCALE);
  group.rotation.set(0, 0, GLOBE_TILT);
  const landPoints = createLandPoints(landData, palette.point);
  const graticule = createGraticule(palette.line);
  group.add(landPoints, graticule, ...links.map((link) => link.mesh));
  return { group, landPoints, graticule };
};

export const createHeroGlobe = (options: HeroGlobeOptions): HeroGlobeHandle => {
  const renderer = createRenderer(options.canvas);
  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  const fog = new Fog(new Color(), FOG_NEAR, FOG_FAR);
  scene.fog = fog;

  const palette = createPalette();
  const links = buildLinks(palette.links);
  const parts = createGlobeGroup(options.landPoints, palette, links);
  const globe = parts.group;
  scene.add(globe);

  const markers = EDGES.map((edge) => ({
    id: edge.id,
    local: latLonToVector(edge.lat, edge.lon, GLOBE_RADIUS),
    written: { left: Number.NaN, top: Number.NaN, visible: false, side: "" } as AnchorWrites,
  }));
  const facing = new Map<string, boolean>();
  const viewport = { width: 1, height: 1 };
  const azimuth = { current: 0 };
  /**
   * A frame is only drawn when something changed. `settled` tracks the links'
   * grow/retract animation; `force` covers the one-off changes — a drag, a
   * resize, a theme flip — that move the scene without the clock moving it.
   */
  const render = { force: true, settled: false };

  const retheme = () => {
    const dark = isDarkTheme();
    const accent = dark
      ? readThemeColor(ACCENT_DARK_COLOR, ACCENT_DARK_FALLBACK).color
      : readThemeColor(ACCENT_LIGHT_COLOR, ACCENT_LIGHT_FALLBACK).color;
    palette.point.color.copy(accent);
    palette.links.forEach((material) => {
      material.color.copy(accent);
    });
    const line = readThemeColor(LINE_COLOR, LINE_FALLBACK);
    palette.line.color.copy(line.color);
    palette.line.opacity = line.alpha * (dark ? GRATICULE_DARK_STRENGTH : GRATICULE_LIGHT_STRENGTH);
    fog.color.copy(readThemeColor(CANVAS_COLOR, CANVAS_FALLBACK).color);
    render.force = true;
  };
  retheme();

  const updateMarkers = () => {
    markers.forEach((marker) => {
      scratchPoint.copy(marker.local);
      globe.localToWorld(scratchPoint);
      scratchNormal.copy(marker.local).normalize().applyQuaternion(globe.quaternion);
      scratchToCamera.copy(camera.position).sub(scratchPoint).normalize();
      const alignment = scratchNormal.dot(scratchToCamera);
      const visible = alignment > (facing.get(marker.id) === true ? FACING_EXIT : FACING_ENTER);
      facing.set(marker.id, visible);
      const element = options.anchors.get(marker.id);
      if (!element) {
        return;
      }
      scratchProjected.copy(scratchPoint).project(camera);
      const left = (scratchProjected.x * 0.5 + 0.5) * viewport.width;
      placeAnchor(
        element,
        {
          left,
          top: (scratchProjected.y * -0.5 + 0.5) * viewport.height,
          visible,
          side: left > viewport.width / 2 ? "right" : "left",
        },
        marker.written,
      );
    });
  };

  const updateLinks = (deltaSeconds: number) => {
    const moved = links.map((link) => {
      const active = facing.get(link.from) === true && facing.get(link.to) === true;
      return stepLink(link, active, deltaSeconds);
    });
    render.settled = !moved.includes(true);
  };

  return {
    resize: (width, height) => {
      viewport.width = width;
      viewport.height = height;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      render.force = true;
    },
    frame: (deltaMs) => {
      const spin = options.reduceMotion ? 0 : ROTATION_PER_MS * deltaMs;
      // Nothing turning, nothing animating, nothing asked for: the last frame
      // is still correct. This is the whole budget for a reduced-motion visit.
      if (spin === 0 && render.settled && !render.force) {
        return;
      }
      render.force = false;
      azimuth.current += spin;
      camera.position.set(
        Math.sin(azimuth.current) * CAMERA_DISTANCE,
        0,
        Math.cos(azimuth.current) * CAMERA_DISTANCE,
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      globe.updateMatrixWorld();
      updateMarkers();
      updateLinks(deltaMs / 1000);
      renderer.render(scene, camera);
    },
    nudge: (deltaRadians) => {
      azimuth.current += deltaRadians;
      render.force = true;
    },
    retheme,
    dispose: () => {
      parts.landPoints.geometry.dispose();
      parts.graticule.geometry.dispose();
      links.forEach((link) => {
        link.mesh.geometry.dispose();
      });
      palette.point.dispose();
      palette.line.dispose();
      palette.links.forEach((material) => {
        material.dispose();
      });
      renderer.dispose();
    },
  };
};
