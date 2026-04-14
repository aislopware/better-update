import { getApiError } from "@better-update/api-client";
import { completeBuild, reserveBuild } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Input } from "@better-update/ui/components/ui/input";
import { Label } from "@better-update/ui/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { Add01Icon, CloudUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  DISTRIBUTIONS_BY_PLATFORM,
  DISTRIBUTION_LABELS,
  FORMATS_BY_PLATFORM,
  FORMAT_LABELS,
  PHASE_LABELS,
  computeSha256,
  detectArtifactFormat,
  detectPlatform,
  formatBytes,
  invalidateBuildQueries,
  progressWidth,
  uploadWithProgress,
} from "./-build-helpers";

import type {
  ArtifactFormatValue,
  DistributionValue,
  PlatformValue,
  UploadPhase,
} from "./-build-helpers";

const handleDragOver = (event: React.DragEvent) => {
  event.preventDefault();
};

interface MetadataValues {
  profile: string;
  runtimeVersion: string;
  appVersion: string;
  buildNumber: string;
  bundleId: string;
  gitRef: string;
  gitCommit: string;
  message: string;
}

const EMPTY_METADATA: MetadataValues = {
  profile: "",
  runtimeVersion: "",
  appVersion: "",
  buildNumber: "",
  bundleId: "",
  gitRef: "",
  gitCommit: "",
  message: "",
};

const buildMetadataPayload = (metadata: MetadataValues) => ({
  ...(metadata.profile && { profile: metadata.profile }),
  ...(metadata.runtimeVersion && { runtimeVersion: metadata.runtimeVersion }),
  ...(metadata.appVersion && { appVersion: metadata.appVersion }),
  ...(metadata.buildNumber && { buildNumber: metadata.buildNumber }),
  ...(metadata.bundleId && { bundleId: metadata.bundleId }),
  ...(metadata.gitRef && { gitRef: metadata.gitRef }),
  ...(metadata.gitCommit && { gitCommit: metadata.gitCommit }),
  ...(metadata.message && { message: metadata.message }),
});

const MetadataFields = ({
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

const ProgressBar = ({ phase, progress }: { phase: UploadPhase; progress: number }) =>
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

const UploadForm = ({
  projectId,
  orgId,
  onSuccess,
}: {
  projectId: string;
  orgId: string;
  onSuccess: () => void;
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState<PlatformValue>("ios");
  const [distribution, setDistribution] = useState<DistributionValue>("development");
  const [artifactFormat, setArtifactFormat] = useState<ArtifactFormatValue | "">("");
  const [metadata, setMetadata] = useState(EMPTY_METADATA);
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const uploadBuildMutation = useMutation({
    mutationFn: async (input: {
      file: File;
      platform: PlatformValue;
      distribution: DistributionValue;
      artifactFormat: ArtifactFormatValue;
      metadata: MetadataValues;
      controller: AbortController;
    }) => {
      const reservedBuild = await reserveBuild({
        projectId,
        platform: input.platform,
        distribution: input.distribution,
        artifactFormat: input.artifactFormat,
        ...buildMetadataPayload(input.metadata),
      });

      setUploadPhase("uploading");
      await uploadWithProgress(
        reservedBuild.uploadUrl,
        input.file,
        setUploadProgress,
        input.controller.signal,
      );

      setUploadPhase("completing");
      const sha256 = await computeSha256(input.file);
      return completeBuild(reservedBuild.id, { sha256, byteSize: input.file.size });
    },
    onSuccess: async () => {
      toast.success("Build uploaded successfully");
      await invalidateBuildQueries(queryClient, orgId, projectId);
      onSuccess();
    },
    onError: (error) => {
      if (!(error instanceof Error && error.message === "Upload aborted")) {
        toast.error(getApiError(error));
      }
      setUploadPhase("idle");
    },
    onSettled: () => {
      abortRef.current = null;
    },
  });

  useMountEffect(() => () => {
    abortRef.current?.abort();
  });

  const updateMetadata = (field: keyof MetadataValues, value: string) => {
    setMetadata((current) => ({ ...current, [field]: value }));
  };

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    const format = detectArtifactFormat(selectedFile.name);
    if (format) {
      setArtifactFormat(format);
      const detectedPlatform = detectPlatform(format);
      if (detectedPlatform) {
        setPlatform(detectedPlatform);
        if (!DISTRIBUTIONS_BY_PLATFORM[detectedPlatform].includes(distribution)) {
          setDistribution(DISTRIBUTIONS_BY_PLATFORM[detectedPlatform][0]);
        }
      }
    } else {
      setArtifactFormat("");
    }
  };

  const handlePlatformChange = (newPlatform: PlatformValue) => {
    setPlatform(newPlatform);
    if (!DISTRIBUTIONS_BY_PLATFORM[newPlatform].includes(distribution)) {
      setDistribution(DISTRIBUTIONS_BY_PLATFORM[newPlatform][0]);
    }
    if (artifactFormat !== "" && !FORMATS_BY_PLATFORM[newPlatform].includes(artifactFormat)) {
      setArtifactFormat(FORMATS_BY_PLATFORM[newPlatform][0]);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer.files[0]) {
      handleFileSelect(event.dataTransfer.files[0]);
    }
  };

  const handleUpload = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || !artifactFormat) {
      return;
    }

    setUploadPhase("reserving");
    const controller = new AbortController();
    abortRef.current = controller;
    await uploadBuildMutation
      .mutateAsync({
        file,
        platform,
        distribution,
        artifactFormat,
        metadata,
        controller,
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === "Upload aborted") {
          setUploadPhase("idle");
        }
      });
  };

  return (
    <form onSubmit={handleUpload} className="flex flex-col gap-4">
      {/* File drop zone */}
      <button
        type="button"
        className={`hover:border-primary/50 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${file ? "border-primary bg-primary/5" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
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
              handleFileSelect(ev.target.files[0]);
            }
          }}
        />
      </button>

      {/* Platform + Distribution + Format */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-2">
          <Label>Platform</Label>
          <Select
            value={platform}
            onValueChange={(value) => {
              if (value) {
                handlePlatformChange(value);
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
                setDistribution(value);
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
                setArtifactFormat(value);
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

      {/* Optional metadata fields */}
      <MetadataFields values={metadata} onChange={updateMetadata} />

      <ProgressBar phase={uploadPhase} progress={uploadProgress} />

      {/* Submit */}
      <Button type="submit" disabled={!file || !artifactFormat || uploadPhase !== "idle"}>
        {PHASE_LABELS[uploadPhase]}
      </Button>
    </form>
  );
};

export const UploadBuildDialog = ({ projectId, orgId }: { projectId: string; orgId: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
        Upload build
      </Button>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload a build</DialogTitle>
          <DialogDescription>Upload an app binary to the build registry.</DialogDescription>
        </DialogHeader>
        {open && (
          <UploadForm
            projectId={projectId}
            orgId={orgId}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
