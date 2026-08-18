// Analytics read models (Workers Analytics Engine aggregations), extracted
// from models.ts to keep that file under the line budget — same convention as
// env-var-models.ts / debug-artifact-models.ts / submission-models.ts.
//
// Every result carries `unavailable`. Analytics reads are best-effort — a
// deployment that cannot reach Analytics Engine still renders its dashboard —
// but "could not ask" and "asked, nothing there" are different answers and the
// flag is what tells them apart downstream (see cloudflare/analytics-engine.ts).

export interface UpdateAdoptionEntryModel {
  readonly updateId: string;
  readonly devices: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface UpdateAdoptionResultModel {
  readonly updates: readonly UpdateAdoptionEntryModel[];
  readonly unavailable: boolean;
}

export interface AnalyticsResponseTypeBreakdownModel {
  readonly manifest: number;
  readonly directive: number;
  readonly noUpdate: number;
}

export interface AnalyticsTimeSeriesEntryModel {
  readonly timestamp: string;
  readonly requests: number;
}

export interface UpdateAnalyticsModel {
  readonly updateId: string;
  readonly totalRequests: number;
  readonly uniqueDevices: number;
  readonly byResponseType: AnalyticsResponseTypeBreakdownModel;
  readonly timeSeries: readonly AnalyticsTimeSeriesEntryModel[];
  readonly unavailable: boolean;
}

export interface ChannelAnalyticsModel {
  readonly channel: string;
  readonly totalRequests: number;
  readonly uniqueDevices: number;
  readonly responseTypeDistribution: AnalyticsResponseTypeBreakdownModel;
  readonly unavailable: boolean;
}

export interface PlatformAnalyticsEntryModel {
  readonly platform: string;
  readonly requests: number;
  readonly devices: number;
}

export interface PlatformAnalyticsResultModel {
  readonly platforms: readonly PlatformAnalyticsEntryModel[];
  readonly unavailable: boolean;
}

/**
 * What the bundle route actually served, from the delivery dataset. The
 * manifest dataset counts *checks*; this counts *downloads*, which is a
 * different (smaller) number — a device that is already up to date checks and
 * downloads nothing.
 */
export interface DeliveryAnalyticsModel {
  /** Bundle requests that produced a body — patch or full. */
  readonly downloads: number;
  readonly patchDownloads: number;
  readonly fullDownloads: number;
  /** Requests for an unknown update or a mismatched runtime version. */
  readonly notFound: number;
  /** Bytes actually sent, patches included. */
  readonly bytesServed: number;
  /**
   * Requests whose client advertised `a-im: bsdiff`. The denominator for patch
   * hit-rate: patches served / requests that could have taken one.
   */
  readonly patchEligibleRequests: number;
  readonly unavailable: boolean;
}
