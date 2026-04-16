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
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  DISTRIBUTIONS_BY_PLATFORM,
  computeSha256,
  defaultDistributionForFormat,
  defaultFormatForDistribution,
  detectArtifactFormat,
  detectPlatform,
  invalidateBuildQueries,
  isCompatibleBuildSelection,
  uploadWithProgress,
} from "./-build-helpers";
import {
  BuildTargetFields,
  FileDropZone,
  MetadataFields,
  ProgressBar,
  SubmitButton,
} from "./-upload-build-form-parts";

import type {
  ArtifactFormatValue,
  DistributionValue,
  PlatformValue,
  UploadPhase,
} from "./-build-helpers";
import type { MetadataValues } from "./-upload-build-form-parts";

const handleDragOver = (event: React.DragEvent) => {
  event.preventDefault();
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

const buildReservePayload = (params: {
  readonly projectId: string;
  readonly platform: PlatformValue;
  readonly distribution: DistributionValue;
  readonly artifactFormat: ArtifactFormatValue;
  readonly metadata: MetadataValues;
  readonly sha256: string;
  readonly byteSize: number;
}) => {
  const metadataPayload = buildMetadataPayload(params.metadata);

  if (
    params.platform === "ios" &&
    params.distribution === "simulator" &&
    params.artifactFormat === "tar.gz"
  ) {
    return {
      projectId: params.projectId,
      platform: "ios" as const,
      distribution: "simulator" as const,
      artifactFormat: "tar.gz" as const,
      sha256: params.sha256,
      byteSize: params.byteSize,
      ...metadataPayload,
    };
  }

  if (
    params.platform === "ios" &&
    (params.distribution === "app-store" ||
      params.distribution === "ad-hoc" ||
      params.distribution === "development" ||
      params.distribution === "enterprise") &&
    params.artifactFormat === "ipa"
  ) {
    return {
      projectId: params.projectId,
      platform: "ios" as const,
      distribution: params.distribution,
      artifactFormat: "ipa" as const,
      sha256: params.sha256,
      byteSize: params.byteSize,
      ...metadataPayload,
    };
  }

  if (
    params.platform === "android" &&
    params.distribution === "play-store" &&
    params.artifactFormat === "aab"
  ) {
    return {
      projectId: params.projectId,
      platform: "android" as const,
      distribution: "play-store" as const,
      artifactFormat: "aab" as const,
      sha256: params.sha256,
      byteSize: params.byteSize,
      ...metadataPayload,
    };
  }

  if (
    params.platform === "android" &&
    params.distribution === "direct" &&
    params.artifactFormat === "apk"
  ) {
    return {
      projectId: params.projectId,
      platform: "android" as const,
      distribution: "direct" as const,
      artifactFormat: "apk" as const,
      sha256: params.sha256,
      byteSize: params.byteSize,
      ...metadataPayload,
    };
  }

  return null;
};

type ReservePayload = NonNullable<ReturnType<typeof buildReservePayload>>;

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
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const uploadBuildMutation = useMutation({
    mutationFn: async (input: {
      file: File;
      reservePayload: ReservePayload;
      sha256: string;
      controller: AbortController;
    }) => {
      const reserved = await reserveBuild(input.reservePayload);
      setUploadPhase("uploading");
      await uploadWithProgress(
        reserved.uploadUrl,
        input.file,
        setUploadProgress,
        input.controller.signal,
        reserved.uploadHeaders,
      );
      setUploadPhase("completing");
      return completeBuild(reserved.id, { sha256: input.sha256, byteSize: input.file.size });
    },
    onSuccess: async () => {
      toast.success("Build uploaded successfully");
      await invalidateBuildQueries(queryClient, orgId, projectId);
      onSuccess();
    },
    onError: (error) => {
      if (!abortRef.current?.signal.aborted) {
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
    if (!format) {
      setArtifactFormat("");
      return;
    }

    setArtifactFormat(format);
    const detectedPlatform = detectPlatform(format);
    if (detectedPlatform && detectedPlatform !== platform) {
      setPlatform(detectedPlatform);
    }

    const nextPlatform = detectedPlatform ?? platform;
    if (!DISTRIBUTIONS_BY_PLATFORM[nextPlatform].includes(distribution)) {
      setDistribution(defaultDistributionForFormat(nextPlatform, format));
      return;
    }

    if (!isCompatibleBuildSelection(nextPlatform, distribution, format)) {
      setDistribution(defaultDistributionForFormat(nextPlatform, format));
    }
  };

  const handlePlatformChange = (newPlatform: PlatformValue) => {
    const nextDistribution = DISTRIBUTIONS_BY_PLATFORM[newPlatform].includes(distribution)
      ? distribution
      : DISTRIBUTIONS_BY_PLATFORM[newPlatform][0];
    const nextFormat =
      artifactFormat !== "" &&
      isCompatibleBuildSelection(newPlatform, nextDistribution, artifactFormat)
        ? artifactFormat
        : defaultFormatForDistribution(newPlatform, nextDistribution);

    setPlatform(newPlatform);
    setDistribution(nextDistribution);
    setArtifactFormat(nextFormat);
  };

  const handleDistributionChange = (value: DistributionValue) => {
    setDistribution(value);
    if (artifactFormat !== "" && !isCompatibleBuildSelection(platform, value, artifactFormat)) {
      setArtifactFormat(defaultFormatForDistribution(platform, value));
    }
  };

  const handleArtifactFormatChange = (value: ArtifactFormatValue) => {
    setArtifactFormat(value);
    if (!isCompatibleBuildSelection(platform, distribution, value)) {
      setDistribution(defaultDistributionForFormat(platform, value));
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
    const sha256 = await computeSha256(file);
    const reservePayload = buildReservePayload({
      projectId,
      platform,
      distribution,
      artifactFormat,
      metadata,
      sha256,
      byteSize: file.size,
    });
    if (!reservePayload) {
      toast.error("Invalid build combination");
      setUploadPhase("idle");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    uploadBuildMutation.mutate({ file, reservePayload, sha256, controller });
  };

  return (
    <form onSubmit={handleUpload} className="flex flex-col gap-4">
      <FileDropZone
        file={file}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onFileSelect={handleFileSelect}
      />
      <BuildTargetFields
        platform={platform}
        distribution={distribution}
        artifactFormat={artifactFormat}
        onPlatformChange={handlePlatformChange}
        onDistributionChange={handleDistributionChange}
        onArtifactFormatChange={handleArtifactFormatChange}
      />
      <MetadataFields values={metadata} onChange={updateMetadata} />
      <ProgressBar phase={uploadPhase} progress={uploadProgress} />
      <SubmitButton
        disabled={!file || !artifactFormat || uploadPhase !== "idle"}
        phase={uploadPhase}
      />
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
        {open ? (
          <UploadForm
            projectId={projectId}
            orgId={orgId}
            onSuccess={() => {
              setOpen(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
