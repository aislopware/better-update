import { getApiError } from "@better-update/api-client";
import { fetchInstallLink } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { toastManager } from "@better-update/ui/components/ui/toast";
import { SmartphoneIcon, CopyIcon, CheckIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore, useState } from "react";

import type { BuildWithArtifact } from "@better-update/api";
import type { ComponentProps } from "react";

import { useApiMutation } from "../../../../../lib/use-api-mutation";
import { useCopyToClipboard } from "../../../../../lib/use-copy-to-clipboard";

const CopyButton = ({ text }: { text: string }) => {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = async () => {
    const ok = await copy(text);
    if (!ok) {
      toastManager.add({ title: "Failed to copy to clipboard", type: "error" });
    }
  };

  const Icon = copied ? CheckIcon : CopyIcon;

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      <Icon strokeWidth={2} data-icon="inline-start" />
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
};

const minutesRemaining = (expiresUnix: number) =>
  Math.max(0, Math.floor((expiresUnix * 1000 - Date.now()) / 60_000));

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

export const InstallLinkDialog = ({
  build,
  buttonLabel,
  buttonVariant = "ghost",
  buttonSize = "icon",
}: {
  build: typeof BuildWithArtifact.Type;
  buttonLabel?: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  buttonSize?: ComponentProps<typeof Button>["size"];
}) => {
  const [open, setOpen] = useState(false);
  const fetchInstallLinkMutation = useApiMutation({
    mutationFn: async () => fetchInstallLink(build.id),
  });

  const handleOpen = () => {
    setOpen(true);
    fetchInstallLinkMutation.mutate();
  };

  const primaryUrl =
    fetchInstallLinkMutation.status === "success"
      ? (fetchInstallLinkMutation.data.installUrl ?? fetchInstallLinkMutation.data.artifactUrl)
      : "";
  const isIosInstall =
    fetchInstallLinkMutation.status === "success" &&
    fetchInstallLinkMutation.data.installUrl !== null;

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        title={buttonLabel ?? "Install link"}
        onClick={handleOpen}
      >
        <SmartphoneIcon strokeWidth={2} data-icon={buttonLabel ? "inline-start" : undefined} />
        {buttonLabel ? <span>{buttonLabel}</span> : null}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            fetchInstallLinkMutation.reset();
          }
        }}
      >
        <DialogPopup className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install link</DialogTitle>
            <DialogDescription>
              {isIosInstall
                ? "Scan the QR code on an iOS device to install this build"
                : "Share this link to download the build artifact"}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            {fetchInstallLinkMutation.isPending && (
              <div className="flex items-center justify-center py-6">
                <div className="text-muted-foreground text-sm">Generating install link...</div>
              </div>
            )}

            {fetchInstallLinkMutation.isError && (
              <div className="flex flex-col items-center gap-4 py-4">
                <p className="text-destructive text-sm">
                  {getApiError(fetchInstallLinkMutation.error)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    fetchInstallLinkMutation.mutate();
                  }}
                >
                  Retry
                </Button>
              </div>
            )}

            {fetchInstallLinkMutation.status === "success" && (
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
                  <ExpiryBadge expires={fetchInstallLinkMutation.data.expires} />
                </div>

                <div className="flex w-full flex-col gap-2">
                  <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
                    <code className="flex-1 truncate text-xs">{primaryUrl}</code>
                    <CopyButton text={primaryUrl} />
                  </div>

                  {isIosInstall && (
                    <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
                      <code className="flex-1 truncate text-xs">
                        {fetchInstallLinkMutation.data.artifactUrl}
                      </code>
                      <CopyButton text={fetchInstallLinkMutation.data.artifactUrl} />
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
};
