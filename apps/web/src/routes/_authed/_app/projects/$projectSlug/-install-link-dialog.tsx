import { getApiError } from "@better-update/api-client";
import { fetchInstallLink } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@better-update/ui/components/ui/alert";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@better-update/ui/components/ui/input-group";
import { Spinner } from "@better-update/ui/components/ui/spinner";
import { differenceInMinutes } from "date-fns";
import { CircleAlertIcon, SmartphoneIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore, useState } from "react";

import type { BuildWithArtifact } from "@better-update/api";
import type { ComponentProps } from "react";

import { CopyButton } from "../../../../../lib/copy-button";
import { useApiMutation } from "../../../../../lib/use-api-mutation";

const minutesRemaining = (expiresUnix: number) =>
  Math.max(0, differenceInMinutes(expiresUnix * 1000, Date.now()));

const subscribeMinuteTick = (onStoreChange: () => void) => {
  const id = setInterval(onStoreChange, 60_000);
  return () => {
    clearInterval(id);
  };
};

const getMinuteSnapshot = () => Math.floor(Date.now() / 60_000);

const ExpiryBadge = ({ expires }: { expires: number }) => {
  useSyncExternalStore(subscribeMinuteTick, getMinuteSnapshot);
  return (
    <span className="text-muted-foreground text-xs">
      Expires in {minutesRemaining(expires)} min
    </span>
  );
};

const InstallLinkBody = ({ buildId }: { buildId: string }) => {
  const fetchInstallLinkMutation = useApiMutation({
    mutationFn: async () => fetchInstallLink(buildId),
  });

  useMountEffect(() => {
    fetchInstallLinkMutation.mutate();
  });

  const { status } = fetchInstallLinkMutation;
  const data = status === "success" ? fetchInstallLinkMutation.data : null;
  const primaryUrl = data ? (data.installUrl ?? data.artifactUrl) : "";
  const isIosInstall = data !== null && data.installUrl !== null;

  return (
    <>
      {status === "idle" || status === "pending" ? (
        <div className="flex items-center justify-center gap-2 py-6">
          <Spinner />
          <span className="text-muted-foreground text-sm">Generating install link...</span>
        </div>
      ) : null}

      {status === "error" ? (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Could not generate install link</AlertTitle>
          <AlertDescription>{getApiError(fetchInstallLinkMutation.error)}</AlertDescription>
          <AlertAction>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                fetchInstallLinkMutation.mutate();
              }}
            >
              Retry
            </Button>
          </AlertAction>
        </Alert>
      ) : null}

      {data ? (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-xl border bg-white p-4">
            <QRCodeSVG value={primaryUrl} size={200} level="M" />
          </div>

          <div className="flex items-center gap-2">
            {isIosInstall ? (
              <Badge variant="secondary">iOS Install</Badge>
            ) : (
              <Badge variant="outline">Download link</Badge>
            )}
            <ExpiryBadge expires={data.expires} />
          </div>

          <div className="flex w-full flex-col gap-2">
            <InputGroup>
              <InputGroupInput readOnly value={primaryUrl} className="font-mono text-xs" />
              <InputGroupAddon align="inline-end">
                <CopyButton value={primaryUrl} label="Install link" size="icon-xs" />
              </InputGroupAddon>
            </InputGroup>

            {isIosInstall ? (
              <InputGroup>
                <InputGroupInput readOnly value={data.artifactUrl} className="font-mono text-xs" />
                <InputGroupAddon align="inline-end">
                  <CopyButton value={data.artifactUrl} label="Artifact URL" size="icon-xs" />
                </InputGroupAddon>
              </InputGroup>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
};

export const InstallLinkDialog = ({
  build,
  buttonLabel,
  buttonVariant = "ghost",
  buttonSize,
  buttonClassName,
}: {
  build: BuildWithArtifact;
  buttonLabel?: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  buttonSize?: ComponentProps<typeof Button>["size"];
  buttonClassName?: string;
}) => {
  const effectiveButtonSize = buttonSize ?? (buttonLabel ? undefined : "icon");
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  return (
    <>
      <Button
        variant={buttonVariant}
        size={effectiveButtonSize}
        className={buttonClassName}
        title={buttonLabel ?? "Install link"}
        onClick={() => {
          setOpen(true);
        }}
      >
        <SmartphoneIcon strokeWidth={2} data-icon={buttonLabel ? "inline-start" : undefined} />
        {buttonLabel ? <span>{buttonLabel}</span> : null}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setResetKey((prev) => prev + 1);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install link</DialogTitle>
            <DialogDescription>
              Scan the QR code on a device, or copy the link to share.
            </DialogDescription>
          </DialogHeader>
          <InstallLinkBody key={resetKey} buildId={build.id} />
        </DialogContent>
      </Dialog>
    </>
  );
};
