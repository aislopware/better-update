// Analytics read models (Workers Analytics Engine aggregations), extracted
// from models.ts to keep that file under the line budget — same convention as
// env-var-models.ts / debug-artifact-models.ts / submission-models.ts.

export interface UpdateAdoptionEntryModel {
  readonly updateId: string;
  readonly devices: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

export interface UpdateAdoptionResultModel {
  readonly updates: readonly UpdateAdoptionEntryModel[];
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
}

export interface ChannelAnalyticsModel {
  readonly channel: string;
  readonly totalRequests: number;
  readonly uniqueDevices: number;
  readonly responseTypeDistribution: AnalyticsResponseTypeBreakdownModel;
}

export interface PlatformAnalyticsEntryModel {
  readonly platform: string;
  readonly requests: number;
  readonly devices: number;
}

export interface PlatformAnalyticsResultModel {
  readonly platforms: readonly PlatformAnalyticsEntryModel[];
}
