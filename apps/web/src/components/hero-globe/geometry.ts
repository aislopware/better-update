import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  InstancedMesh,
  LineSegments,
  Object3D,
  Shape,
  ShapeGeometry,
  Vector3,
} from "three";

import type { LineBasicMaterial, MeshBasicMaterial } from "three";

const DEGREES = Math.PI / 180;

export const GLOBE_RADIUS = 0.99;

/** Land-point cloud: one instance per lit pixel of an equirectangular land mask. */
export const LAND_POINT_COUNT = 16_098;
const LAND_POINT_SIZE = 0.006;
/** Points ship as unit vectors quantised to signed 16-bit — 3 shorts per point. */
const INT16_MAX = 32_767;

const MERIDIAN_COUNT = 24;
const PARALLEL_COUNT = 23;
/** Great circles through the poles' axis, offset in 30° steps. */
const DIAGONAL_COUNT = 12;
/** Parallels closer than this to the equator are dropped — the equator is its own line. */
const EQUATOR_GUARD_DEGREES = 5;

const LINK_SEGMENTS = 20;
/** Peak bulge of a link above the sphere, as a fraction of the radius. */
const LINK_LIFT = 0.3;

const noRaycast = () => undefined;

/**
 * Geographic coordinates onto the sphere. `x` is negated so that longitude
 * increases eastward when the globe is viewed from `+z`.
 */
export const latLonToVector = (lat: number, lon: number, radius: number): Vector3 => {
  const polar = (90 - lat) * DEGREES;
  const azimuth = (lon + 180) * DEGREES;
  return new Vector3(
    -radius * Math.sin(polar) * Math.cos(azimuth),
    radius * Math.cos(polar),
    radius * Math.sin(polar) * Math.sin(azimuth),
  );
};

/**
 * A square with softened corners. Squares read as "pixels" of a map at this
 * size, but hard corners alias badly once a few thousand of them are packed
 * near the sphere's silhouette.
 */
const roundedSquare = (size: number): Shape => {
  const half = size / 2;
  const corner = size * 0.167;
  const shape = new Shape();
  shape.moveTo(-half + corner, -half);
  shape.lineTo(half - corner, -half);
  shape.quadraticCurveTo(half, -half, half, -half + corner);
  shape.lineTo(half, half - corner);
  shape.quadraticCurveTo(half, half, half - corner, half);
  shape.lineTo(-half + corner, half);
  shape.quadraticCurveTo(-half, half, -half, half - corner);
  shape.lineTo(-half, -half + corner);
  shape.quadraticCurveTo(-half, -half, -half + corner, -half);
  return shape;
};

/**
 * One instanced quad per land point, each turned to face the sphere's centre so
 * it lies flat on the surface. A single instanced draw keeps 16k points at one
 * draw call; the alternative (a `Points` cloud) cannot round its corners or
 * follow the curvature.
 */
export const createLandPoints = (
  positions: Int16Array,
  material: MeshBasicMaterial,
): InstancedMesh<ShapeGeometry, MeshBasicMaterial> => {
  const count = Math.min(LAND_POINT_COUNT, Math.floor(positions.length / 3));
  const mesh = new InstancedMesh<ShapeGeometry, MeshBasicMaterial>(
    new ShapeGeometry(roundedSquare(LAND_POINT_SIZE)),
    material,
    count,
  );
  const anchor = new Object3D();
  Array.from({ length: count }).forEach((_, index) => {
    const offset = index * 3;
    anchor.position.set(
      ((positions[offset] ?? 0) / INT16_MAX) * GLOBE_RADIUS,
      ((positions[offset + 1] ?? 0) / INT16_MAX) * GLOBE_RADIUS,
      ((positions[offset + 2] ?? 0) / INT16_MAX) * GLOBE_RADIUS,
    );
    anchor.lookAt(0, 0, 0);
    anchor.updateMatrix();
    mesh.setMatrixAt(index, anchor.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.raycast = noRaycast;
  return mesh;
};

const meridianPoints = (lon: number): Vector3[] =>
  Array.from({ length: 181 }, (_, index) => latLonToVector(index - 90, lon, GLOBE_RADIUS));

const parallelPoints = (lat: number): Vector3[] =>
  Array.from({ length: 361 }, (_, index) => latLonToVector(lat, index - 180, GLOBE_RADIUS));

/**
 * A great circle tilted around the vertical axis by `azimuth`. These are what
 * make the wireframe read as a woven sphere rather than a globe stand: they cut
 * across the lat/long grid instead of following it.
 */
const diagonalPoints = (azimuth: number): Vector3[] =>
  Array.from({ length: 181 }, (_, index) => {
    const angle = index * 2 * DEGREES;
    return new Vector3(
      GLOBE_RADIUS * Math.sin(angle) * Math.cos(azimuth),
      GLOBE_RADIUS * Math.cos(angle),
      GLOBE_RADIUS * Math.sin(angle) * Math.sin(azimuth),
    );
  });

export type Graticule = LineSegments<BufferGeometry, LineBasicMaterial>;

/** A polyline flattened into the vertex pairs `LineSegments` expects. */
const toSegments = (points: readonly Vector3[]): number[] =>
  points.slice(0, -1).flatMap((point, index) => {
    const next = points[index + 1] ?? point;
    return [point.x, point.y, point.z, next.x, next.y, next.z];
  });

/**
 * Meridians, parallels, the equator and the diagonal great circles, welded into
 * one `LineSegments`. Kept as ~60 separate `Line` objects this was ~60 draw
 * calls every frame for a decoration; as one buffer it is a single call, and
 * the whole wireframe still shares the one material a theme flip writes to.
 */
export const createGraticule = (material: LineBasicMaterial): Graticule => {
  const meridians = Array.from({ length: MERIDIAN_COUNT }, (_, index) =>
    meridianPoints(-180 + (360 / MERIDIAN_COUNT) * index),
  );
  const parallels = Array.from(
    { length: PARALLEL_COUNT },
    (_, index) => -90 + (180 / (PARALLEL_COUNT + 1)) * (index + 1),
  )
    .filter((lat) => Math.abs(lat) >= EQUATOR_GUARD_DEGREES)
    .map(parallelPoints);
  const diagonals = Array.from({ length: DIAGONAL_COUNT }, (_, index) =>
    diagonalPoints(index * (360 / DIAGONAL_COUNT) * DEGREES),
  );

  const vertices = [...meridians, parallelPoints(0), ...parallels, ...diagonals].flatMap(
    toSegments,
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  const lines: Graticule = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.raycast = noRaycast;
  return lines;
};

/**
 * The path a link takes between two cities: a straight interpolation pushed
 * radially outward by `-t² + t`, so it leaves and re-enters the surface
 * perpendicular-ish and bulges most at the midpoint.
 */
export const createLinkCurve = (from: Vector3, to: Vector3): CatmullRomCurve3 =>
  new CatmullRomCurve3(
    Array.from({ length: LINK_SEGMENTS + 1 }, (_, index) => {
      const ratio = index / LINK_SEGMENTS;
      const lift = ratio - ratio * ratio;
      const point = from.clone().lerp(to, ratio);
      return point.add(
        point
          .clone()
          .normalize()
          .multiplyScalar(lift * LINK_LIFT),
      );
    }),
  );
