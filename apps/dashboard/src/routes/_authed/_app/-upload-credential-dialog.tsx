import { credentialsQueryKey, uploadCredential } from "@better-update/api-client/react";
import { toBase64 } from "@better-update/encoding";
import { Button } from "@better-update/ui/components/ui/button";
import { DatePicker } from "@better-update/ui/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@better-update/ui/components/ui/field";
import { Input } from "@better-update/ui/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@better-update/ui/components/ui/select";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { PlusIcon, CloudUploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useApiMutation } from "../../../lib/use-api-mutation";
import {
  ACCEPTED_EXTENSIONS,
  DISTRIBUTIONS,
  DISTRIBUTION_LABELS,
  PLATFORM_LABELS,
  TYPE_LABELS_BY_PLATFORM,
  TYPE_OPTIONS_BY_PLATFORM,
  isCredentialType,
  isDistribution,
} from "./-credential-helpers";

import type { CredentialTypeValue, DistributionValue } from "./-credential-helpers";

const TypeOptionsContent = ({ platform }: { platform: "ios" | "android" }) => (
  <SelectContent>
    <SelectGroup>
      {TYPE_OPTIONS_BY_PLATFORM[platform].map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          {opt.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
);

const DistributionOptionsContent = () => (
  <SelectContent>
    <SelectGroup>
      {DISTRIBUTIONS.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          {opt.label}
        </SelectItem>
      ))}
    </SelectGroup>
  </SelectContent>
);

interface UploadFormValues {
  platform: "" | "ios" | "android";
  credentialType: "" | CredentialTypeValue;
  distribution: "" | DistributionValue;
  name: string;
  file: File | null;
  password: string;
  keyAlias: string;
  keyPassword: string;
  expiresAt: string;
}

const DEFAULT_VALUES: UploadFormValues = {
  platform: "",
  credentialType: "",
  distribution: "",
  name: "",
  file: null,
  password: "",
  keyAlias: "",
  keyPassword: "",
  expiresAt: "",
};

interface SubmitInput {
  readonly file: File;
  readonly platform: "ios" | "android";
  readonly credentialType: CredentialTypeValue;
  readonly name: string;
  readonly distribution: "" | DistributionValue;
  readonly password: string;
  readonly keyAlias: string;
  readonly keyPassword: string;
  readonly expiresAt: string;
}

const submitCredential = async (input: SubmitInput) => {
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
  <Field>
    <FieldLabel>File</FieldLabel>
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
          <CloudUploadIcon
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
  </Field>
);

const buildSubmitInput = (value: UploadFormValues) =>
  !value.file || value.platform === "" || value.credentialType === "" || !value.name
    ? null
    : ({
        ...value,
        file: value.file,
        platform: value.platform,
        credentialType: value.credentialType,
      } satisfies SubmitInput);

const useUploadForm = (onSubmit: (input: SubmitInput) => Promise<unknown>) =>
  useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      const input = buildSubmitInput(value);
      if (input) {
        await onSubmit(input);
      }
    },
  });

type UploadFormApi = ReturnType<typeof useUploadForm>;

const DistributionField = ({ form }: { form: UploadFormApi }) => (
  <form.Field name="distribution">
    {(field) => (
      <Field>
        <FieldLabel>Distribution</FieldLabel>
        <Select
          items={DISTRIBUTION_LABELS}
          value={field.state.value}
          onValueChange={(value) => {
            if (value && isDistribution(value)) {
              field.handleChange(value);
            }
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select distribution" />
          </SelectTrigger>
          <DistributionOptionsContent />
        </Select>
      </Field>
    )}
  </form.Field>
);

const KeystoreFields = ({ form }: { form: UploadFormApi }) => (
  <div className="grid grid-cols-2 gap-3">
    <form.Field name="keyAlias">
      {(field) => (
        <Field>
          <FieldLabel>Key Alias</FieldLabel>
          <Input
            value={field.state.value}
            onChange={(ev) => {
              field.handleChange(ev.target.value);
            }}
            placeholder="e.g. my-key-alias"
          />
        </Field>
      )}
    </form.Field>
    <form.Field name="keyPassword">
      {(field) => (
        <Field>
          <FieldLabel>Key Password</FieldLabel>
          <Input
            type="password"
            value={field.state.value}
            onChange={(ev) => {
              field.handleChange(ev.target.value);
            }}
            placeholder="Key password"
          />
        </Field>
      )}
    </form.Field>
  </div>
);

const UploadForm = ({ orgId, onSuccess }: { orgId: string; onSuccess: () => void }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const uploadCredentialMutation = useApiMutation({
    mutationFn: submitCredential,
    onSuccess: async () => {
      toast.success("Credential uploaded");
      await queryClient.invalidateQueries({ queryKey: credentialsQueryKey(orgId) });
      onSuccess();
    },
  });
  const form = useUploadForm(uploadCredentialMutation.mutateAsync);
  const resetDependentFields = () => {
    form.setFieldValue("distribution", "");
    form.setFieldValue("file", null);
    form.setFieldValue("password", "");
    form.setFieldValue("keyAlias", "");
    form.setFieldValue("keyPassword", "");
  };

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="platform">
          {(field) => (
            <Field>
              <FieldLabel>Platform</FieldLabel>
              <Select
                items={PLATFORM_LABELS}
                value={field.state.value}
                onValueChange={(value) => {
                  if (value === "ios" || value === "android") {
                    field.handleChange(value);
                    form.setFieldValue("credentialType", "");
                    resetDependentFields();
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select platform" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="ios">iOS</SelectItem>
                    <SelectItem value="android">Android</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => state.values.platform}>
          {(platform) =>
            platform ? (
              <form.Field name="credentialType">
                {(field) => (
                  <Field>
                    <FieldLabel>Type</FieldLabel>
                    <Select
                      items={TYPE_LABELS_BY_PLATFORM[platform]}
                      value={field.state.value}
                      onValueChange={(value) => {
                        if (value && isCredentialType(value)) {
                          field.handleChange(value);
                          resetDependentFields();
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select credential type" />
                      </SelectTrigger>
                      <TypeOptionsContent platform={platform} />
                    </Select>
                  </Field>
                )}
              </form.Field>
            ) : null
          }
        </form.Subscribe>

        <form.Subscribe selector={(state) => state.values.credentialType}>
          {(credentialType) => {
            if (!credentialType) {
              return null;
            }
            const showDistribution = credentialType === "provisioning-profile";
            const showPassword =
              credentialType === "distribution-certificate" || credentialType === "keystore";
            const showKeystoreFields = credentialType === "keystore";
            const acceptedExtension = ACCEPTED_EXTENSIONS[credentialType];

            return (
              <>
                <form.Field name="name">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="credential-name">Name</FieldLabel>
                      <Input
                        id="credential-name"
                        value={field.state.value}
                        onChange={(ev) => {
                          field.handleChange(ev.target.value);
                        }}
                        placeholder="e.g. Production Distribution Cert"
                      />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="file">
                  {(field) => (
                    <FileDropZone
                      file={field.state.value}
                      accept={acceptedExtension}
                      fileInputRef={fileInputRef}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (event.dataTransfer.files[0]) {
                          field.handleChange(event.dataTransfer.files[0]);
                        }
                      }}
                      onFileChange={(newFile) => {
                        field.handleChange(newFile);
                      }}
                    />
                  )}
                </form.Field>

                {showDistribution && <DistributionField form={form} />}

                {showPassword && (
                  <form.Field name="password">
                    {(field) => (
                      <Field>
                        <FieldLabel>Password</FieldLabel>
                        <Input
                          type="password"
                          value={field.state.value}
                          onChange={(ev) => {
                            field.handleChange(ev.target.value);
                          }}
                          placeholder="Certificate / keystore password"
                        />
                      </Field>
                    )}
                  </form.Field>
                )}

                {showKeystoreFields && <KeystoreFields form={form} />}

                <form.Field name="expiresAt">
                  {(field) => {
                    const dateValue = field.state.value
                      ? new Date(`${field.state.value}T00:00:00`)
                      : undefined;
                    return (
                      <Field>
                        <FieldLabel>Expiry Date (optional)</FieldLabel>
                        <DatePicker
                          value={dateValue}
                          onChange={(value) => {
                            field.handleChange(value ? format(value, "yyyy-MM-dd") : "");
                          }}
                        />
                      </Field>
                    );
                  }}
                </form.Field>
              </>
            );
          }}
        </form.Subscribe>

        <form.Subscribe selector={submitSelector}>
          {([hasRequired, isSubmitting]) => (
            <Button
              type="submit"
              disabled={!hasRequired || isSubmitting || uploadCredentialMutation.isPending}
            >
              {isSubmitting || uploadCredentialMutation.isPending ? "Uploading..." : "Upload"}
            </Button>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
};

const submitSelector = (state: {
  readonly values: UploadFormValues;
  readonly isSubmitting: boolean;
}) =>
  [
    Boolean(
      state.values.file &&
      state.values.platform &&
      state.values.credentialType &&
      state.values.name,
    ),
    state.isSubmitting,
  ] as const;

export const UploadCredentialDialog = ({ orgId }: { orgId: string }) => {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        <PlusIcon strokeWidth={2} data-icon="inline-start" />
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
