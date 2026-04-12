import { getApiError } from "@better-update/api-client";
import { uploadCredential } from "@better-update/api-client/react";
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

const IOS_TYPES = [
  { value: "distribution-certificate", label: "Distribution Certificate (.p12)" },
  { value: "provisioning-profile", label: "Provisioning Profile (.mobileprovision)" },
  { value: "push-key", label: "Push Notification Key (.p8)" },
] as const;

const ANDROID_TYPES = [
  { value: "keystore", label: "Keystore (.jks / .keystore)" },
  { value: "play-service-account", label: "Play Service Account (.json)" },
] as const;

const DISTRIBUTIONS = [
  { value: "ad-hoc", label: "Ad Hoc" },
  { value: "app-store", label: "App Store" },
  { value: "development", label: "Development" },
  { value: "enterprise", label: "Enterprise" },
] as const;

type CredentialTypeValue =
  | (typeof IOS_TYPES)[number]["value"]
  | (typeof ANDROID_TYPES)[number]["value"];
type DistributionValue = (typeof DISTRIBUTIONS)[number]["value"];

const CREDENTIAL_TYPE_VALUES = new Set<string>(
  [...IOS_TYPES, ...ANDROID_TYPES].map((opt) => opt.value),
);
const DISTRIBUTION_VALUES = new Set<string>(DISTRIBUTIONS.map((opt) => opt.value));

const isCredentialType = (value: string): value is CredentialTypeValue =>
  CREDENTIAL_TYPE_VALUES.has(value);
const isDistribution = (value: string): value is DistributionValue =>
  DISTRIBUTION_VALUES.has(value);

const ACCEPTED_EXTENSIONS: Record<string, string> = {
  "distribution-certificate": ".p12",
  "provisioning-profile": ".mobileprovision",
  "push-key": ".p8",
  keystore: ".jks,.keystore",
  "play-service-account": ".json",
};

const TYPE_OPTIONS_BY_PLATFORM: Record<string, typeof IOS_TYPES | typeof ANDROID_TYPES> = {
  ios: IOS_TYPES,
  android: ANDROID_TYPES,
};

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
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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
    }
  };

  const handleTypeChange = (value: string) => {
    if (isCredentialType(value)) {
      setCredentialType(value);
      setDistribution("");
      setFile(null);
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
    setIsUploading(true);
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const binary = [...bytes].map((byte) => String.fromCodePoint(byte)).join("");
      const blob = btoa(binary);

      await uploadCredential({
        platform,
        type: credentialType,
        name,
        blob,
        ...(distribution ? { distribution } : {}),
        ...(password ? { password } : {}),
        ...(keyAlias ? { keyAlias } : {}),
        ...(keyPassword ? { keyPassword } : {}),
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      });

      toast.success("Credential uploaded");
      await queryClient.invalidateQueries({ queryKey: ["org", orgId, "credentials"] });
      onSuccess();
    } catch (error) {
      toast.error(getApiError(error));
    } finally {
      setIsUploading(false);
    }
  };

  const canSubmit = Boolean(file && platform && credentialType && name && !isUploading);

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

      {/* Distribution (provisioning profiles only) */}
      {showDistribution && (
        <div className="flex flex-col gap-2">
          <Label>Distribution</Label>
          <Select
            value={distribution}
            onValueChange={(value) => {
              if (value && isDistribution(value)) {
                setDistribution(value);
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

      {/* Password (certs and keystores) */}
      {showPassword && (
        <div className="flex flex-col gap-2">
          <Label>Password</Label>
          <Input
            type="password"
            value={password}
            onChange={(ev) => {
              setPassword(ev.target.value);
            }}
            placeholder="Certificate / keystore password"
          />
        </div>
      )}

      {/* Keystore-specific fields */}
      {showKeystoreFields && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label>Key Alias</Label>
            <Input
              value={keyAlias}
              onChange={(ev) => {
                setKeyAlias(ev.target.value);
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
                setKeyPassword(ev.target.value);
              }}
              placeholder="Key password"
            />
          </div>
        </div>
      )}

      {/* Expiry date */}
      {credentialType && (
        <div className="flex flex-col gap-2">
          <Label>Expiry Date (optional)</Label>
          <Input
            type="date"
            value={expiresAt}
            onChange={(ev) => {
              setExpiresAt(ev.target.value);
            }}
          />
        </div>
      )}

      {/* Submit */}
      <Button disabled={!canSubmit} onClick={handleUpload}>
        {isUploading ? "Uploading..." : "Upload"}
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
