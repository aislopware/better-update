import { getApiError } from "@better-update/api-client";
import { fetchInstallLink } from "@better-update/api-client/react";
import { useMountEffect } from "@better-update/react-hooks";
import { Badge } from "@better-update/ui/components/badge";
import { Banner } from "@better-update/ui/components/banner";
import { Button } from "@better-update/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/dialog";
import { InputGroup } from "@better-update/ui/components/input-group";
import { Loader } from "@better-update/ui/components/loader";
import { cn } from "@better-update/ui/lib/utils";
import { DeviceMobileIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { differenceInMinutes } from "date-fns";
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
    <span className="text-kumo-subtle text-xs">Expires in {minutesRemaining(expires)} min</span>
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
          <Loader size="sm" />
          <span className="text-kumo-subtle text-sm">Generating install link...</span>
        </div>
      ) : null}

      {status === "error" ? (
        <Banner
          variant="error"
          icon={<WarningCircleIcon weight="fill" />}
          title="Could not generate install link"
          description={getApiError(fetchInstallLinkMutation.error)}
          action={
            <Banner.Action
              variant="secondary"
              onClick={() => {
                fetchInstallLinkMutation.mutate();
              }}
            >
              Retry
            </Banner.Action>
          }
        />
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
              <InputGroup.Input readOnly value={primaryUrl} className="font-mono text-xs" />
              <InputGroup.Addon align="end">
                <CopyButton value={primaryUrl} label="Install link" size="xs" />
              </InputGroup.Addon>
            </InputGroup>

            {isIosInstall ? (
              <InputGroup>
                <InputGroup.Input readOnly value={data.artifactUrl} className="font-mono text-xs" />
                <InputGroup.Addon align="end">
                  <CopyButton value={data.artifactUrl} label="Artifact URL" size="xs" />
                </InputGroup.Addon>
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
  const [open, setOpen] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Kumo discriminates its Button props on `shape`, so the icon-only form has
  // to be its own element rather than a computed shape.
  const triggerProps = {
    variant: buttonVariant,
    size: buttonSize ?? "base",
    className: cn(buttonClassName),
    icon: <DeviceMobileIcon weight="bold" className="size-4" />,
    onClick: () => {
      setOpen(true);
    },
  } as const;

  return (
    <>
      {buttonLabel ? (
        // eslint-disable-next-line react/jsx-props-no-spreading -- shared trigger props, spelled out above
        <Button {...triggerProps} title={buttonLabel}>
          {buttonLabel}
        </Button>
      ) : (
        // eslint-disable-next-line react/jsx-props-no-spreading -- shared trigger props, spelled out above
        <Button {...triggerProps} shape="square" title="Install link" />
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        onOpenChangeComplete={(next) => {
          if (!next) {
            setResetKey((prev) => prev + 1);
          }
        }}
      >
        <DialogContent>
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
