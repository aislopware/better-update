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

/**
 * What the primary link does, so the badge and the QR caption tell the truth:
 * an iOS install manifest, an Android APK a device installs on tap, or a bare
 * download of something a device cannot install (an App Store `.ipa`, a
 * simulator tarball, or an App Bundle uploaded without its universal APK).
 */
const linkKind = (build: BuildWithArtifact, installUrl: string | null) => {
  if (installUrl === null) {
    return "download" as const;
  }
  return build.platform === "ios" ? ("ios-install" as const) : ("android-apk" as const);
};

const LINK_BADGES = {
  "ios-install": { variant: "secondary", label: "iOS Install" },
  "android-apk": { variant: "secondary", label: "Android APK" },
  download: { variant: "outline", label: "Download link" },
} as const;

const InstallLinkBody = ({ build }: { build: BuildWithArtifact }) => {
  const fetchInstallLinkMutation = useApiMutation({
    mutationFn: async () => fetchInstallLink(build.id),
  });

  useMountEffect(() => {
    fetchInstallLinkMutation.mutate();
  });

  const { status } = fetchInstallLinkMutation;
  const data = status === "success" ? fetchInstallLinkMutation.data : null;
  const primaryUrl = data ? (data.installUrl ?? data.artifactUrl) : "";
  const kind = data ? linkKind(build, data.installUrl) : "download";
  const badge = LINK_BADGES[kind];
  // An `.aab` with no universal APK is the one case where the link looks
  // installable and is not: the file downloads fine and then will not install.
  const isBareAab = kind === "download" && build.artifact?.format === "aab";
  // The bundle itself is still worth a link next to the APK — it is what
  // gets submitted to Play.
  const showArtifactUrl =
    data !== null && data.installUrl !== null && data.installUrl !== data.artifactUrl;

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
          // The only banner the app draws inside a dialog: the compact size is
          // Kumo's answer for exactly that, and it sizes the Retry down with it.
          size="sm"
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
          {isBareAab ? (
            <Banner
              variant="alert"
              size="sm"
              icon={<WarningCircleIcon weight="fill" />}
              title="Not installable on a device"
              description="This App Bundle has no universal APK attached, and a phone cannot install an .aab. Rebuild with the current CLI to attach one, or convert it locally with bundletool."
            />
          ) : null}

          <div className="rounded-md border bg-white p-4">
            <QRCodeSVG value={primaryUrl} size={200} level="M" />
          </div>

          <div className="flex items-center gap-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <ExpiryBadge expires={data.expires} />
          </div>

          <div className="flex w-full flex-col gap-2">
            <InputGroup>
              <InputGroup.Input readOnly value={primaryUrl} className="font-mono text-xs" />
              <InputGroup.Addon align="end">
                <CopyButton value={primaryUrl} label="Install link" size="xs" />
              </InputGroup.Addon>
            </InputGroup>

            {showArtifactUrl ? (
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

/**
 * Pass `open`/`onOpenChange` when the dialog is opened from a menu: picking the
 * item unmounts the menu, and an uncontrolled dialog would go with it. Without
 * them the dialog carries its own trigger button.
 */
export const InstallLinkDialog = ({
  build,
  buttonLabel,
  buttonVariant = "ghost",
  buttonSize,
  buttonClassName,
  open,
  onOpenChange,
}: {
  build: BuildWithArtifact;
  buttonLabel?: string;
  buttonVariant?: ComponentProps<typeof Button>["variant"];
  buttonSize?: ComponentProps<typeof Button>["size"];
  buttonClassName?: string;
  open?: boolean | undefined;
  onOpenChange?: ((next: boolean) => void) | undefined;
}) => {
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setIsOpen = onOpenChange ?? setOwnOpen;
  const [resetKey, setResetKey] = useState(0);

  // Kumo discriminates its Button props on `shape`, so the icon-only form has
  // to be its own element rather than a computed shape.
  const triggerProps = {
    variant: buttonVariant,
    size: buttonSize ?? "base",
    className: cn(buttonClassName),
    icon: <DeviceMobileIcon weight="bold" className="size-4" />,
    onClick: () => {
      setIsOpen(true);
    },
  } as const;

  const trigger = buttonLabel ? (
    // eslint-disable-next-line react/jsx-props-no-spreading -- shared trigger props, spelled out above
    <Button {...triggerProps} title={buttonLabel}>
      {buttonLabel}
    </Button>
  ) : (
    // eslint-disable-next-line react/jsx-props-no-spreading -- shared trigger props, spelled out above
    <Button {...triggerProps} shape="square" title="Install link" />
  );

  return (
    <>
      {open === undefined ? trigger : null}
      <Dialog
        open={isOpen}
        onOpenChange={setIsOpen}
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
          <InstallLinkBody key={resetKey} build={build} />
        </DialogContent>
      </Dialog>
    </>
  );
};
