import {
  androidApplicationIdentifiersQueryOptions,
  androidUploadKeystoresQueryOptions,
  googleServiceAccountKeysQueryOptions,
} from "@better-update/api-client/react";
import { Button } from "@better-update/ui/components/ui/button";
import { Field, FieldError, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { useSuspenseQuery } from "@tanstack/react-query";

import { safeReadFileAsBase64, safeReadFileAsText } from "../../-credentials-utils";

import type { WizardState } from "./-android-wizard-state";

const PACKAGE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/u;

export const StepAppId = ({
  orgId,
  projectId,
  state,
  onChange,
}: {
  orgId: string;
  projectId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(androidApplicationIdentifiersQueryOptions(orgId, projectId));
  return (
    <div className="flex flex-col gap-3">
      {data.items.length > 0 ? (
        <Field>
          <FieldLabel htmlFor="wiz-app-existing">Existing application identifier</FieldLabel>
          <Select
            value={state.existingAppIdentifierId}
            onValueChange={(value) => {
              const appId = typeof value === "string" ? value : "";
              const match = data.items.find((item) => item.id === appId);
              onChange({
                ...state,
                existingAppIdentifierId: appId,
                packageName: match === undefined ? "" : match.packageName,
              });
            }}
          >
            <SelectTrigger id="wiz-app-existing">
              <SelectValue placeholder="Select existing or create new below" />
            </SelectTrigger>
            <SelectPopup>
              {data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.packageName}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="wiz-package">Package name</FieldLabel>
        <Input
          id="wiz-package"
          value={state.packageName}
          disabled={state.existingAppIdentifierId.length > 0}
          onChange={(event) => {
            onChange({ ...state, packageName: event.target.value });
          }}
          placeholder="com.example.app"
        />
        <FieldError
          match={state.packageName.length > 0 && !PACKAGE_PATTERN.test(state.packageName)}
        >
          Invalid package name
        </FieldError>
      </Field>
    </div>
  );
};

const KeystoreUploadFields = ({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => (
  <div className="flex flex-col gap-3">
    <Field>
      <FieldLabel htmlFor="wiz-keystore-file">Keystore file (.jks / .p12)</FieldLabel>
      <Input
        id="wiz-keystore-file"
        type="file"
        accept=".jks,.keystore,.p12"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file === undefined) {
            return;
          }
          const value = await safeReadFileAsBase64(file);
          if (value === null) {
            toastManager.add({ title: "Failed to read keystore", type: "error" });
            return;
          }
          onChange({ ...state, keystoreFile: value });
        }}
      />
    </Field>
    <Field>
      <FieldLabel htmlFor="wiz-keystore-alias">Key alias</FieldLabel>
      <Input
        id="wiz-keystore-alias"
        value={state.keyAlias}
        onChange={(event) => {
          onChange({ ...state, keyAlias: event.target.value });
        }}
      />
    </Field>
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel htmlFor="wiz-keystore-pass">Keystore password</FieldLabel>
        <Input
          id="wiz-keystore-pass"
          type="password"
          value={state.keystorePassword}
          onChange={(event) => {
            onChange({ ...state, keystorePassword: event.target.value });
          }}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="wiz-key-pass">Key password</FieldLabel>
        <Input
          id="wiz-key-pass"
          type="password"
          value={state.keyPassword}
          onChange={(event) => {
            onChange({ ...state, keyPassword: event.target.value });
          }}
        />
      </Field>
    </div>
  </div>
);

export const StepKeystore = ({
  orgId,
  state,
  onChange,
}: {
  orgId: string;
  state: WizardState;
  onChange: (next: WizardState) => void;
}) => {
  const { data } = useSuspenseQuery(androidUploadKeystoresQueryOptions(orgId));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button
          variant={state.keystoreMode === "upload" ? "default" : "outline"}
          onClick={() => {
            onChange({ ...state, keystoreMode: "upload", keystoreId: "" });
          }}
        >
          Upload new
        </Button>
        <Button
          variant={state.keystoreMode === "existing" ? "default" : "outline"}
          disabled={data.items.length === 0}
          onClick={() => {
            onChange({ ...state, keystoreMode: "existing" });
          }}
        >
          Pick existing
        </Button>
      </div>
      {state.keystoreMode === "existing" ? (
        <Field>
          <FieldLabel htmlFor="wiz-keystore-existing">Keystore</FieldLabel>
          <Select
            value={state.keystoreId}
            onValueChange={(value) => {
              onChange({ ...state, keystoreId: typeof value === "string" ? value : "" });
            }}
          >
            <SelectTrigger id="wiz-keystore-existing">
              <SelectValue placeholder="Select a keystore" />
            </SelectTrigger>
            <SelectPopup>
              {data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.keyAlias}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      ) : (
        <KeystoreUploadFields state={state} onChange={onChange} />
      )}
    </div>
  );
};

const readJsonFile = async (
  event: React.ChangeEvent<HTMLInputElement>,
  setter: (text: string) => void,
) => {
  const file = event.target.files?.[0];
  if (file === undefined) {
    return;
  }
  const value = await safeReadFileAsText(file);
  if (value === null) {
    toastManager.add({ title: "Failed to read JSON", type: "error" });
    return;
  }
  setter(value);
};

export const StepGoogleSa = ({
  orgId,
  label,
  mode,
  saId,
  onModeChange,
  onIdChange,
  onJsonChange,
}: {
  orgId: string;
  label: string;
  mode: "existing" | "upload" | "skip";
  saId: string;
  onModeChange: (next: "existing" | "upload" | "skip") => void;
  onIdChange: (next: string) => void;
  onJsonChange: (next: string) => void;
}) => {
  const { data } = useSuspenseQuery(googleServiceAccountKeysQueryOptions(orgId));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex gap-2">
        <Button
          variant={mode === "skip" ? "default" : "outline"}
          onClick={() => {
            onModeChange("skip");
          }}
        >
          Skip
        </Button>
        <Button
          variant={mode === "existing" ? "default" : "outline"}
          disabled={data.items.length === 0}
          onClick={() => {
            onModeChange("existing");
          }}
        >
          Pick existing
        </Button>
        <Button
          variant={mode === "upload" ? "default" : "outline"}
          onClick={() => {
            onModeChange("upload");
          }}
        >
          Upload new
        </Button>
      </div>
      {mode === "existing" ? (
        <Field>
          <FieldLabel htmlFor={`wiz-sa-${label}`}>Service account key</FieldLabel>
          <Select
            value={saId}
            onValueChange={(value) => {
              onIdChange(typeof value === "string" ? value : "");
            }}
          >
            <SelectTrigger id={`wiz-sa-${label}`}>
              <SelectValue placeholder="Select key" />
            </SelectTrigger>
            <SelectPopup>
              {data.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.clientEmail}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </Field>
      ) : null}
      {mode === "upload" ? (
        <Field>
          <FieldLabel htmlFor={`wiz-sa-upload-${label}`}>Service account JSON</FieldLabel>
          <Input
            id={`wiz-sa-upload-${label}`}
            type="file"
            accept=".json,application/json"
            onChange={async (event) => {
              await readJsonFile(event, onJsonChange);
            }}
          />
        </Field>
      ) : null}
    </div>
  );
};

export const StepReview = ({ state }: { state: WizardState }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
    <dt className="text-muted-foreground">Package</dt>
    <dd className="font-mono">{state.packageName}</dd>
    <dt className="text-muted-foreground">Keystore</dt>
    <dd>{state.keystoreMode === "existing" ? "Existing" : "Uploading new"}</dd>
    <dt className="text-muted-foreground">Play SA</dt>
    <dd>{state.submissionsSaMode}</dd>
    <dt className="text-muted-foreground">FCM SA</dt>
    <dd>{state.fcmSaMode}</dd>
    <dt className="text-muted-foreground">Name</dt>
    <dd>{state.name}</dd>
    <dt className="text-muted-foreground">Default</dt>
    <dd>{state.isDefault ? "Yes" : "No"}</dd>
  </dl>
);
