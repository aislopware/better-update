/**
 * The edge cities and inter-city links the hero globe draws. Data only — both
 * the WebGL scene and the HTML overlay read from here so a marker and its
 * caption can never drift out of sync.
 */

/**
 * A few edges carry a caption card. Cards always hang to the left of their
 * marker — that is the open half of the hero; the right is under the sign-in
 * panel — and only while the city has orbited onto the left of the globe, so a
 * card never lies across the continents.
 *
 * `place` staggers the cards vertically. Captioned cities are spread far enough
 * apart in longitude that at most two are ever open at once, and those two are
 * always in different vertical bands.
 */
export interface Caption {
  readonly place: "above" | "below";
  readonly value: string;
  readonly text: string;
}

export interface Edge {
  readonly id: string;
  readonly lat: number;
  readonly lon: number;
  readonly caption?: Caption;
}

export const EDGES: readonly Edge[] = [
  {
    id: "iad",
    lat: 39.04,
    lon: -77.49,
    caption: {
      place: "above",
      value: "1.2 s",
      text: "Median time from publishing a release to the first device holding it.",
    },
  },
  { id: "sjc", lat: 37.37, lon: -121.92 },
  { id: "dfw", lat: 32.9, lon: -97.04 },
  { id: "mia", lat: 25.79, lon: -80.29 },
  {
    id: "gru",
    lat: -23.55,
    lon: -46.63,
    caption: {
      place: "above",
      value: "99.98%",
      text: "Update downloads that finish on the first attempt, no retry needed.",
    },
  },
  {
    id: "lhr",
    lat: 51.47,
    lon: -0.45,
    caption: {
      place: "below",
      value: "18 ms",
      text: "Manifest lookups answered at the edge, never from an origin server.",
    },
  },
  { id: "cdg", lat: 49.01, lon: 2.55 },
  { id: "fra", lat: 50.03, lon: 8.56 },
  { id: "ams", lat: 52.31, lon: 4.76 },
  { id: "bom", lat: 19.09, lon: 72.87 },
  {
    id: "sin",
    lat: 1.35,
    lon: 103.82,
    caption: {
      place: "below",
      value: "Every region",
      text: "One signed bundle, served from the city closest to each install.",
    },
  },
  { id: "nrt", lat: 35.76, lon: 140.39 },
  { id: "syd", lat: -33.95, lon: 151.18 },
  { id: "jnb", lat: -26.14, lon: 28.24 },
];

export interface Link {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export const LINKS: readonly Link[] = [
  { id: "iad-lhr", from: "iad", to: "lhr" },
  { id: "sjc-nrt", from: "sjc", to: "nrt" },
  { id: "lhr-sin", from: "lhr", to: "sin" },
  { id: "iad-gru", from: "iad", to: "gru" },
  { id: "fra-bom", from: "fra", to: "bom" },
  { id: "sin-syd", from: "sin", to: "syd" },
];

export const EDGE_BY_ID: ReadonlyMap<string, Edge> = new Map(EDGES.map((edge) => [edge.id, edge]));
