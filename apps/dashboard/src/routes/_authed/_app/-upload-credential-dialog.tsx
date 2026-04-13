import { credentialsQueryKey, uploadCredential } from "@better-update/api-client/react";
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
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { toBase64 } from "../../../lib/base64";
import { useApiMutation } from "../../../lib/use-api-mutation";
import {
  ACCEPTED_EXTENSIONS,
  DISTRIBUTIONS,
  TYPE_OPTIONS_BY_PLATFORM,
  isCredentialType,
  isDistribution,
} from "./-credential-helpers";

import type { CredentialTypeValue, DistributionValue } from "./-credential-helpers";

const handleDragOver = (event: React.DragEvent) => {
  event.preventDefault();
};

const FileDropZone = ({
  file,
  accept,
  fileInputRef,
  onDrop,
  onFileChange,
}: {
  file: File | null;
  accept: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onDrop: (event: React.DragEvent) => void;
  onFileChange: (file: File) => void;
}) => (
  <div className="flex flex-col gap-2">
    <Label>File</Label>
    <button
      type="button"
      className={`hover:border-primary/50 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${file ? "border-primary bg-primary/5" : ""}`}
      onDrop={onDrop}
      onDragOver={handleDragOver}
      onClick={() => fileInputRef.current?.click()}
    >
      {file ? (
        <p className="font-medium">{file.name}</p>
      ) : (
        <div>
          <HugeiconsIcon
            icon={CloudUploadIcon}
            strokeWidth={1.5}
            className="text-muted-foreground mx-auto mb-2 size-8"
          />
          <p className="text-sm font-medium">Drop a file here or click to browse</p>
          {accept && <p className="text-muted-foreground mt-1 text-xs">{accept}</p>}
        </div>
      )}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept={accept}
        onChange={(ev) => {
          if (ev.target.files?.[0]) {
            onFileChange(ev.target.files[0]);
          }
        }}
      />
    </button>
  </div>
);

const CredentialOptionalFields = ({
  showDistribution,
  distribution,
  onDistributionChange,
  showPassword,
  password,
  onPasswordChange,
  showKeystoreFields,
  keyAlias,
  onKeyAliasChange,
  keyPassword,
  onKeyPasswordChange,
  expiresAt,
  onExpiresAtChange,
}: {
  showDistribution: boolean;
  distribution: "" | DistributionValue;
  onDistributionChange: (value: DistributionValue) => void;
  showPassword: boolean;
  password: string;
  onPasswordChange: (value: string) => void;
  showKeystoreFields: boolean;
  keyAlias: string;
  onKeyAliasChange: (value: string) => void;
  keyPassword: string;
  onKeyPasswordChange: (value: string) => void;
  expiresAt: string;
  onExpiresAtChange: (value: string) => void;
}) => (
  <>
    {showDistribution && (
      <div className="flex flex-col gap-2">
        <Label>Distribution</Label>
        <Select
          value={distribution}
          onValueChange={(value) => {
            if (value && isDistribution(value)) {
              onDistributionChange(value);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select distribution" />
          </SelectTrigger>
          <SelectContent>
            {DISTRIBUTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )}

    {showPassword && (
      <div className="flex flex-col gap-2">
        <Label>Password</Label>
        <Input
          type="password"
          value={password}
          onChange={(ev) => {
            onPasswordChange(ev.target.value);
          }}
          placeholder="Certificate / keystore password"
        />
      </div>
    )}

    {showKeystoreFields && (
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label>Key Alias</Label>
          <Input
            value={keyAlias}
            onChange={(ev) => {
              onKeyAliasChange(ev.target.value);
            }}
            placeholder="e.g. my-key-alias"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>Key Password</Label>
          <Input
            type="password"
            value={keyPassword}
            onChange={(ev) => {
              onKeyPasswordChange(ev.target.value);
            }}
            placeholder="Key password"
          />
        </div>
      </div>
    )}

    <div className="flex flex-col gap-2">
      <Label>Expiry Date (optional)</Label>
      <Input
        type="date"
        value={expiresAt}
        onChange={(ev) => {
          onExpiresAtChange(ev.target.value);
        }}
      />
    </div>
  </>
);

const UploadForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const [platform, setPlatform] = useState<"" | "ios" | "android">("");
  const [credentialType, setCredentialType] = useState<"" | CredentialTypeValue>("");
  const [distribution, setDistribution] = useState<"" | DistributionValue>("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [keyAlias, setKeyAlias] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const uploadCredentialMutation = useApiMutation({
    mutationFn: async (input: {
      file: File;
      platform: "ios" | "android";
      credentialType: CredentialTypeValue;
      name: string;
      distribution: "" | DistributionValue;
      password: string;
      keyAlias: string;
      keyPassword: string;
      expiresAt: string;
    }) => {
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      return uploadCredential({
        platform: input.platform,
        type: input.credentialType,
        name: input.name,
        blob: toBase64(bytes),
        ...(input.distribution ? { distribution: input.distribution } : {}),
        ...(input.password ? { password: input.password } : {}),
        ...(input.keyAlias ? { keyAlias: input.keyAlias } : {}),
        ...(input.keyPassword ? { keyPassword: input.keyPassword } : {}),
        ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
      });
    },
    onSuccess: async () => {
      toast.success("Credential uploaded");
      await queryClient.invalidateQueries({
        queryKey: credentialsQueryKey(orgId),
      });
      onSuccess();
    },
  });

  const typeOptions = TYPE_OPTIONS_BY_PLATFORM[platform] ?? [];
  const showDistribution = credentialType === "provisioning-profile";
  const showPassword =
    credentialType === "distribution-certificate" || credentialType === "keystore";
  const showKeystoreFields = credentialType === "keystore";
  const acceptedExtension = credentialType ? (ACCEPTED_EXTENSIONS[credentialType] ?? "") : "";

  const handlePlatformChange = (value: string) => {
    if (value === "ios" || value === "android") {
      setPlatform(value);
      setCredentialType("");
      setDistribution("");
      setFile(null);
      setPassword("");
      setKeyAlias("");
      setKeyPassword("");
    }
  };

  const handleTypeChange = (value: string) => {
    if (isCredentialType(value)) {
      setCredentialType(value);
      setDistribution("");
      setFile(null);
      setPassword("");
      setKeyAlias("");
      setKeyPassword("");
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    if (event.dataTransfer.files[0]) {
      setFile(event.dataTransfer.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file || !platform || !credentialType || !name) {
      return;
    }
    await uploadCredentialMutation.mutateAsync({
      file,
      platform,
      credentialType,
      name,
      distribution,
      password,
      keyAlias,
      keyPassword,
      expiresAt,
    });
  };

  const canSubmit = Boolean(
    file && platform && credentialType && name && !uploadCredentialMutation.isPending,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Platform */}
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
            <SelectValue placeholder="Select platform" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ios">iOS</SelectItem>
            <SelectItem value="android">Android</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Credential type */}
      {platform && (
        <div className="flex flex-col gap-2">
          <Label>Type</Label>
          <Select
            value={credentialType}
            onValueChange={(value) => {
              if (value) {
                handleTypeChange(value);
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select credential type" />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Name */}
      {credentialType && (
        <div className="flex flex-col gap-2">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(ev) => {
              setName(ev.target.value);
            }}
            placeholder="e.g. Production Distribution Cert"
          />
        </div>
      )}

      {/* File upload */}
      {credentialType && (
        <FileDropZone
          file={file}
          accept={acceptedExtension}
          fileInputRef={fileInputRef}
          onDrop={handleDrop}
          onFileChange={setFile}
        />
      )}

      {credentialType && (
        <CredentialOptionalFields
          showDistribution={showDistribution}
          distribution={distribution}
          onDistributionChange={setDistribution}
          showPassword={showPassword}
          password={password}
          onPasswordChange={setPassword}
          showKeystoreFields={showKeystoreFields}
          keyAlias={keyAlias}
          onKeyAliasChange={setKeyAlias}
          keyPassword={keyPassword}
          onKeyPasswordChange={setKeyPassword}
          expiresAt={expiresAt}
          onExpiresAtChange={setExpiresAt}
        />
      )}

      {/* Submit */}
      <Button disabled={!canSubmit} onClick={handleUpload}>
        {uploadCredentialMutation.isPending ? "Uploading..." : "Upload"}
      </Button>
    </div>
  );
};

export const UploadCredentialDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} className="size-4" />
        Upload
      </Button>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload credential</DialogTitle>
          <DialogDescription>
            Upload a signing credential for iOS or Android builds.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <UploadForm
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
