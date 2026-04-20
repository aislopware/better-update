export const BUNDLE_PATTERN = /^[A-Za-z0-9.\-_]{1,200}$/u;

export type DistributionType = "APP_STORE" | "DEVELOPMENT" | "ENTERPRISE";

export interface WizardState {
  readonly bundleIdentifier: string;
  readonly distributionType: DistributionType;
  readonly appleTeamId: string;
  readonly certId: string;
  readonly pushKeyId: string;
  readonly ascKeyId: string;
  readonly profileId: string;
  readonly deviceIds: readonly string[];
}

export const INITIAL: WizardState = {
  bundleIdentifier: "",
  distributionType: "APP_STORE",
  appleTeamId: "",
  certId: "",
  pushKeyId: "",
  ascKeyId: "",
  profileId: "",
  deviceIds: [],
};

export const canAdvance = (state: WizardState, step: number): boolean => {
  if (step === 1) {
    return BUNDLE_PATTERN.test(state.bundleIdentifier);
  }
  if (step === 2) {
    return state.appleTeamId.length > 0;
  }
  if (step === 3) {
    return state.certId.length > 0;
  }
  if (step === 4) {
    return true;
  }
  if (step === 5) {
    return state.ascKeyId.length > 0;
  }
  if (step === 6) {
    return state.profileId.length > 0;
  }
  if (step === 7) {
    return true;
  }
  return false;
};
