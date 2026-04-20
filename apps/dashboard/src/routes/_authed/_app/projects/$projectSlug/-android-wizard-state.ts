import {
  createAndroidApplicationIdentifier,
  uploadAndroidUploadKeystore,
  uploadGoogleServiceAccountKey,
} from "@better-update/api-client/react";

export const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/u;

export interface WizardState {
  readonly packageName: string;
  readonly existingAppIdentifierId: string;
  readonly keystoreMode: "existing" | "upload";
  readonly keystoreId: string;
  readonly keystoreFile: string;
  readonly keyAlias: string;
  readonly keystorePassword: string;
  readonly keyPassword: string;
  readonly submissionsSaMode: "existing" | "upload" | "skip";
  readonly submissionsSaId: string;
  readonly submissionsSaJson: string;
  readonly fcmSaMode: "existing" | "upload" | "skip";
  readonly fcmSaId: string;
  readonly fcmSaJson: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export const INITIAL: WizardState = {
  packageName: "",
  existingAppIdentifierId: "",
  keystoreMode: "upload",
  keystoreId: "",
  keystoreFile: "",
  keyAlias: "",
  keystorePassword: "",
  keyPassword: "",
  submissionsSaMode: "skip",
  submissionsSaId: "",
  submissionsSaJson: "",
  fcmSaMode: "skip",
  fcmSaId: "",
  fcmSaJson: "",
  name: "Default",
  isDefault: true,
};

export const resolveAppIdentifierId = async (
  projectId: string,
  state: WizardState,
): Promise<string> => {
  if (state.existingAppIdentifierId.length > 0) {
    return state.existingAppIdentifierId;
  }
  const created = await createAndroidApplicationIdentifier(projectId, {
    packageName: state.packageName,
  });
  return created.id;
};

export const resolveKeystoreId = async (state: WizardState): Promise<string> => {
  if (state.keystoreMode === "existing") {
    return state.keystoreId;
  }
  const created = await uploadAndroidUploadKeystore({
    keystoreBase64: state.keystoreFile,
    keyAlias: state.keyAlias,
    keystorePassword: state.keystorePassword,
    keyPassword: state.keyPassword,
  });
  return created.id;
};

export const resolveSaId = async (
  mode: "existing" | "upload" | "skip",
  input: { existing: string; json: string },
): Promise<string | undefined> => {
  if (mode === "skip") {
    return undefined;
  }
  if (mode === "existing") {
    return input.existing;
  }
  const created = await uploadGoogleServiceAccountKey({ json: input.json });
  return created.id;
};

export const canAdvance = (state: WizardState, step: number): boolean => {
  if (step === 1) {
    return state.existingAppIdentifierId.length > 0 || PACKAGE_PATTERN.test(state.packageName);
  }
  if (step === 2) {
    if (state.keystoreMode === "existing") {
      return state.keystoreId.length > 0;
    }
    return (
      state.keystoreFile.length > 0 &&
      state.keyAlias.length > 0 &&
      state.keystorePassword.length > 0 &&
      state.keyPassword.length > 0
    );
  }
  if (step === 3) {
    if (state.submissionsSaMode === "existing") {
      return state.submissionsSaId.length > 0;
    }
    if (state.submissionsSaMode === "upload") {
      return state.submissionsSaJson.length > 0;
    }
    return true;
  }
  if (step === 4) {
    if (state.fcmSaMode === "existing") {
      return state.fcmSaId.length > 0;
    }
    if (state.fcmSaMode === "upload") {
      return state.fcmSaJson.length > 0;
    }
    return true;
  }
  return false;
};
