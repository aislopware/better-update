import { Button } from "@better-update/ui/components/ui/button";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRef } from "react";

import {
  DISTRIBUTIONS_BY_PLATFORM,
  DISTRIBUTION_LABELS,
  FORMATS_BY_PLATFORM,
  FORMAT_LABELS,
  PHASE_LABELS,
  formatBytes,
  progressWidth,
} from "./-build-helpers";

import type {
  ArtifactFormatValue,
  DistributionValue,
  PlatformValue,
  UploadPhase,
} from "./-build-helpers";

export interface MetadataValues {
  profile: string;
  runtimeVersion: string;
  appVersion: string;
  buildNumber: string;
  bundleId: string;
  gitRef: string;
  gitCommit: string;
  message: string;
}

export const MetadataFields = ({
  values,
  onChange,
}: {
  values: MetadataValues;
  onChange: (field: keyof MetadataValues, value: string) => void;
}) => (
  <>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2">
        <Label>Profile</Label>
        <Input
          value={values.profile}
          onChange={(ev) => {
            onChange("profile", ev.target.value);
          }}
          placeholder="e.g. production"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Runtime Version</Label>
        <Input
          value={values.runtimeVersion}
          onChange={(ev) => {
            onChange("runtimeVersion", ev.target.value);
          }}
          placeholder="e.g. 1.0.0"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>App Version</Label>
        <Input
          value={values.appVersion}
          onChange={(ev) => {
            onChange("appVersion", ev.target.value);
          }}
          placeholder="e.g. 2.1.0"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Build Number</Label>
        <Input
          value={values.buildNumber}
          onChange={(ev) => {
            onChange("buildNumber", ev.target.value);
          }}
          placeholder="e.g. 42"
        />
      </div>
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-2">
        <Label>Bundle ID</Label>
        <Input
          value={values.bundleId}
          onChange={(ev) => {
            onChange("bundleId", ev.target.value);
          }}
          placeholder="e.g. com.example.app"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Git Ref</Label>
        <Input
          value={values.gitRef}
          onChange={(ev) => {
            onChange("gitRef", ev.target.value);
          }}
          placeholder="e.g. main"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label>Git Commit</Label>
        <Input
          value={values.gitCommit}
          onChange={(ev) => {
            onChange("gitCommit", ev.target.value);
          }}
          placeholder="e.g. a1b2c3d"
        />
      </div>
    </div>

    <div className="flex flex-col gap-2">
      <Label>Message</Label>
      <Input
        value={values.message}
        onChange={(ev) => {
          onChange("message", ev.target.value);
        }}
        placeholder="e.g. Release candidate 1"
      />
    </div>
  </>
);

export const ProgressBar = ({ phase, progress }: { phase: UploadPhase; progress: number }) =>
  phase === "idle" ? null : (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-sm">
        <span>{PHASE_LABELS[phase]}</span>
        {phase === "uploading" && <span>{progress}%</span>}
      </div>
      <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
        <div
          className="bg-primary h-full rounded-full transition-all"
          style={{ width: progressWidth(phase, progress) }}
        />
      </div>
    </div>
  );

export const FileDropZone = ({
  file,
  onDrop,
  onDragOver,
  onFileSelect,
}: {
  file: File | null;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      type="button"
      className={`hover:border-primary/50 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${file ? "border-primary bg-primary/5" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onClick={() => fileInputRef.current?.click()}
    >
      {file ? (
        <div>
          <p className="font-medium">{file.name}</p>
          <p className="text-muted-foreground text-sm">{formatBytes(file.size)}</p>
        </div>
      ) : (
        <div>
          <HugeiconsIcon
            icon={CloudUploadIcon}
            strokeWidth={1.5}
            className="text-muted-foreground mx-auto mb-2 size-8"
          />
          <p className="text-sm font-medium">Drop a file here or click to browse</p>
          <p className="text-muted-foreground mt-1 text-xs">.ipa, .apk, .aab, or .tar.gz</p>
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".ipa,.apk,.aab,.tar.gz"
        onChange={(ev) => {
          if (ev.target.files?.[0]) {
            onFileSelect(ev.target.files[0]);
          }
        }}
      />
    </button>
  );
};

export const BuildTargetFields = ({
  platform,
  distribution,
  artifactFormat,
  onPlatformChange,
  onDistributionChange,
  onArtifactFormatChange,
}: {
  platform: PlatformValue;
  distribution: DistributionValue;
  artifactFormat: ArtifactFormatValue | "";
  onPlatformChange: (platform: PlatformValue) => void;
  onDistributionChange: (distribution: DistributionValue) => void;
  onArtifactFormatChange: (format: ArtifactFormatValue) => void;
}) => (
  <div className="grid grid-cols-3 gap-3">
    <div className="flex flex-col gap-2">
      <Label>Platform</Label>
      <Select
        value={platform}
        onValueChange={(value) => {
          if (value) {
            onPlatformChange(value);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ios">iOS</SelectItem>
          <SelectItem value="android">Android</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-2">
      <Label>Distribution</Label>
      <Select
        value={distribution}
        onValueChange={(value) => {
          if (value) {
            onDistributionChange(value);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DISTRIBUTIONS_BY_PLATFORM[platform].map((dist) => (
            <SelectItem key={dist} value={dist}>
              {DISTRIBUTION_LABELS[dist]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-2">
      <Label>Format</Label>
      <Select
        value={artifactFormat}
        onValueChange={(value) => {
          if (value) {
            onArtifactFormatChange(value);
          }
        }}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {FORMATS_BY_PLATFORM[platform].map((fmt) => (
            <SelectItem key={fmt} value={fmt}>
              {FORMAT_LABELS[fmt]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
);

export const SubmitButton = ({ disabled, phase }: { disabled: boolean; phase: UploadPhase }) => (
  <Button type="submit" disabled={disabled}>
    {PHASE_LABELS[phase]}
  </Button>
);
