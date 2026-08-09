import { Badge } from "@better-update/ui/components/badge";
import { cn } from "@better-update/ui/lib/utils";
import {
  BroadcastIcon,
  BuildingsIcon,
  CheckCircleIcon,
  CodeIcon,
  DownloadSimpleIcon,
  FlaskIcon,
  MonitorIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  RocketIcon,
  StorefrontIcon,
  TagIcon,
  WarningIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

import type { BuildDistribution, PlatformValue } from "@better-update/api-client/react";
import type { ComponentType, ReactElement } from "react";

import { AndroidIcon } from "./android-icon";
import { AppleIcon } from "./apple-icon";

type BadgeVariant = "outline" | "secondary" | "info" | "success" | "warning";
type BadgeSize = "sm" | "default" | "lg";

/**
 * Kumo's Badge is a bare pill: it sets no gap between its children and nothing
 * that sizes an icon inside it — only the `dot` appearance gets a gap, and it
 * draws its own dot. Both are ours to say, per size, so the mark keeps its
 * distance from the word at every scale.
 */
const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: "h-4 gap-1 px-1.5 text-[0.65rem]",
  default: "gap-1",
  lg: "h-6 gap-1.5 px-2.5 text-sm",
};

/** Set in `em` so one rule covers all three sizes and tracks the label's own. */
const BADGE_ICON = "size-[1em] shrink-0";

interface AttributeBadgeProps {
  size?: BadgeSize;
  className?: string;
}

/** The narrowest shape both icon families satisfy — phosphor's and our own. */
type BadgeIcon = ComponentType<{ className?: string }>;

interface Definition {
  label: string;
  icon: BadgeIcon;
  variant: BadgeVariant;
}

const PLATFORM_DEFS = {
  ios: { label: "iOS", icon: AppleIcon, variant: "outline" },
  android: { label: "Android", icon: AndroidIcon, variant: "outline" },
} as const satisfies Record<PlatformValue, Definition>;

const DISTRIBUTION_DEFS = {
  "app-store": { label: "App Store", icon: StorefrontIcon, variant: "info" },
  "ad-hoc": { label: "Ad Hoc", icon: PaperPlaneTiltIcon, variant: "warning" },
  development: { label: "Development", icon: CodeIcon, variant: "secondary" },
  enterprise: { label: "Enterprise", icon: BuildingsIcon, variant: "secondary" },
  simulator: { label: "Simulator", icon: MonitorIcon, variant: "secondary" },
  "play-store": { label: "Play Store", icon: PlayIcon, variant: "success" },
  direct: { label: "Direct", icon: DownloadSimpleIcon, variant: "outline" },
} as const satisfies Record<BuildDistribution, Definition>;

// Environments are identity, not status — they render neutral (icon carries the
// distinction) so color stays reserved for exceptional states.
const ENVIRONMENT_KNOWN: Record<string, Omit<Definition, "label">> = {
  production: { icon: RocketIcon, variant: "outline" },
  prod: { icon: RocketIcon, variant: "outline" },
  staging: { icon: FlaskIcon, variant: "outline" },
  stage: { icon: FlaskIcon, variant: "outline" },
  development: { icon: WrenchIcon, variant: "outline" },
  dev: { icon: WrenchIcon, variant: "outline" },
  preview: { icon: TagIcon, variant: "outline" },
};

const renderBadge = (
  { label, icon: Icon, variant }: Definition,
  size: BadgeSize | undefined,
  className: string | undefined,
): ReactElement => (
  <Badge variant={variant} className={cn(SIZE_CLASSES[size ?? "default"], className)}>
    <Icon className={BADGE_ICON} />
    {label}
  </Badge>
);

export const PlatformBadge = ({
  platform,
  size,
  className,
}: AttributeBadgeProps & { platform: PlatformValue }): ReactElement =>
  renderBadge(PLATFORM_DEFS[platform], size, className);

/**
 * The platform's mark on its own, for a cell whose words already name the
 * platform — "TestFlight" is not more itself for having "iOS" spelt beside it,
 * but the glyph still lets a reader sort the rows by eye. Decorative by the
 * same token: the text beside it is what a screen reader should read.
 */
export const PlatformGlyph = ({
  platform,
  className,
}: {
  platform: PlatformValue;
  className?: string;
}): ReactElement => {
  const { icon: Icon } = PLATFORM_DEFS[platform];
  return <Icon className={cn("text-kumo-subtle size-3.5 shrink-0", className)} />;
};

/**
 * Quiet icon + plain-text platform cell for table rows — a pill badge in every
 * row reads as noise, so lists use this form and PlatformBadge stays for
 * detail surfaces.
 */
export const PlatformIndicator = ({
  platform,
  className,
}: {
  platform: PlatformValue;
  className?: string;
}): ReactElement => {
  const { label, icon: Icon } = PLATFORM_DEFS[platform];
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Icon className="text-kumo-subtle size-3.5 shrink-0" />
      {label}
    </span>
  );
};

export const DistributionBadge = ({
  distribution,
  size,
  className,
}: AttributeBadgeProps & { distribution: BuildDistribution }): ReactElement =>
  renderBadge(DISTRIBUTION_DEFS[distribution], size, className);

/**
 * Quiet icon + plain-text distribution cell — same rationale as
 * PlatformIndicator: a colored pill on every table row decorates the happy
 * path, so lists use this form and DistributionBadge stays for detail surfaces.
 */
export const DistributionIndicator = ({
  distribution,
  className,
}: {
  distribution: BuildDistribution;
  className?: string;
}): ReactElement => {
  const { label, icon: Icon } = DISTRIBUTION_DEFS[distribution];
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <Icon className="text-kumo-subtle size-3.5 shrink-0" />
      {label}
    </span>
  );
};

export const ChannelBadge = ({
  name,
  size,
  className,
}: AttributeBadgeProps & { name: string }): ReactElement => (
  <Badge variant="outline" className={cn(SIZE_CLASSES[size ?? "default"], className)}>
    <BroadcastIcon weight="bold" className={BADGE_ICON} />
    {name}
  </Badge>
);

// Complete is the expected state — it renders quiet; the pending exception is
// warning-colored text (same icon+text shape, so the column keeps one left edge).
export const SubmissionMetadataBadge = ({
  complete,
  className,
}: AttributeBadgeProps & { complete: boolean }): ReactElement =>
  complete ? (
    <span className={cn("text-kumo-subtle flex items-center gap-1.5 text-sm", className)}>
      <CheckCircleIcon weight="bold" className="size-3.5 shrink-0" />
      Complete
    </span>
  ) : (
    <span className={cn("text-kumo-warning flex items-center gap-1.5 text-sm", className)}>
      <WarningIcon weight="bold" className="size-3.5 shrink-0" />
      Metadata pending
    </span>
  );

export const EnvironmentBadge = ({
  environment,
  size,
  className,
}: AttributeBadgeProps & { environment: string }): ReactElement => {
  const def = ENVIRONMENT_KNOWN[environment.toLowerCase()] ?? {
    icon: TagIcon,
    variant: "outline" as const,
  };
  return renderBadge({ ...def, label: environment }, size, className);
};

export const DISTRIBUTION_BADGE_LABELS: Record<BuildDistribution, string> = {
  "app-store": DISTRIBUTION_DEFS["app-store"].label,
  "ad-hoc": DISTRIBUTION_DEFS["ad-hoc"].label,
  development: DISTRIBUTION_DEFS.development.label,
  enterprise: DISTRIBUTION_DEFS.enterprise.label,
  simulator: DISTRIBUTION_DEFS.simulator.label,
  "play-store": DISTRIBUTION_DEFS["play-store"].label,
  direct: DISTRIBUTION_DEFS.direct.label,
};
