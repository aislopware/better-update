import { fetchInstallLink } from "@better-update/api-client/react";
import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@better-update/ui/components/ui/dialog";
import { SmartPhone02Icon, Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { QRCodeSVG } from "qrcode.react";
import { useSyncExternalStore, useState } from "react";
import { toast } from "sonner";

import type { BuildWithArtifact, InstallLinkResult } from "@better-update/api";

type InstallLinkData = typeof InstallLinkResult.Type;

const CopyButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} className="size-4" />
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

export const InstallLinkDialog = ({ build }: { build: typeof BuildWithArtifact.Type }) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "success"; data: InstallLinkData }
    | { status: "error"; message: string }
  >({ status: "idle" });

  const doFetch = async () => {
    setState({ status: "loading" });
    // eslint-disable-next-line functional/no-try-statements -- imperative shell error handling
    try {
      const data = await fetchInstallLink(build.id);
      setState({ status: "success", data });
    } catch {
      setState({ status: "error", message: "Failed to generate install link" });
    }
  };

  const handleOpen = async () => {
    setOpen(true);
    await doFetch();
  };

  const primaryUrl =
    state.status === "success" ? (state.data.installUrl ?? state.data.artifactUrl) : "";
  const isIosInstall = state.status === "success" && state.data.installUrl !== null;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        title="Install link"
        onClick={handleOpen}
      >
        <HugeiconsIcon icon={SmartPhone02Icon} strokeWidth={2} className="size-4" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setState({ status: "idle" });
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Install link</DialogTitle>
            <DialogDescription>
              {isIosInstall
                ? "Scan the QR code on an iOS device to install this build"
                : "Share this link to download the build artifact"}
            </DialogDescription>
          </DialogHeader>

          {state.status === "loading" && (
            <div className="flex items-center justify-center py-12">
              <div className="text-muted-foreground text-sm">Generating install link...</div>
            </div>
          )}

          {state.status === "error" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <p className="text-destructive text-sm">{state.message}</p>
              <Button variant="outline" size="sm" onClick={doFetch}>
                Retry
              </Button>
            </div>
          )}

          {state.status === "success" && (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-lg border bg-white p-4">
                <QRCodeSVG value={primaryUrl} size={200} level="M" />
              </div>

              <div className="flex items-center gap-2">
                {isIosInstall ? (
                  <Badge variant="secondary">iOS Install</Badge>
                ) : (
                  <Badge variant="outline">Download link</Badge>
                )}
                <ExpiryBadge expires={state.data.expires} />
              </div>

              <div className="flex w-full flex-col gap-2">
                <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
                  <code className="flex-1 truncate text-xs">{primaryUrl}</code>
                  <CopyButton text={primaryUrl} />
                </div>

                {isIosInstall && (
                  <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
                    <code className="flex-1 truncate text-xs">{state.data.artifactUrl}</code>
                    <CopyButton text={state.data.artifactUrl} />
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
