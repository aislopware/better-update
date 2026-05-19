import { Badge } from "@better-update/ui/components/ui/badge";
import {
  AppleIcon,
  BotIcon,
  BuildingIcon,
  CodeIcon,
  DownloadIcon,
  FlaskConicalIcon,
  MonitorIcon,
  PlayIcon,
  RocketIcon,
  SatelliteIcon,
  SendIcon,
  StoreIcon,
  TagIcon,
  WrenchIcon,
} from "lucide-react";

import type { BuildDistribution, PlatformValue } from "@better-update/api-client/react";
import type { BadgeProps } from "@better-update/ui/components/ui/badge";
import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;
type BadgeSize = NonNullable<BadgeProps["size"]>;

interface AttributeBadgeProps {
  size?: BadgeSize;
  className?: string;
}

interface Definition {
  label: string;
  icon: LucideIcon;
  variant: BadgeVariant;
}

const PLATFORM_DEFS = {
  ios: { label: "iOS", icon: AppleIcon, variant: "info" },
  android: { label: "Android", icon: BotIcon, variant: "success" },
} as const satisfies Record<PlatformValue, Definition>;

const DISTRIBUTION_DEFS = {
  "app-store": { label: "App Store", icon: StoreIcon, variant: "info" },
  "ad-hoc": { label: "Ad Hoc", icon: SendIcon, variant: "warning" },
  development: { label: "Development", icon: CodeIcon, variant: "secondary" },
  enterprise: { label: "Enterprise", icon: BuildingIcon, variant: "secondary" },
  simulator: { label: "Simulator", icon: MonitorIcon, variant: "secondary" },
  "play-store": { label: "Play Store", icon: PlayIcon, variant: "success" },
  direct: { label: "Direct", icon: DownloadIcon, variant: "outline" },
} as const satisfies Record<BuildDistribution, Definition>;

const ENVIRONMENT_KNOWN: Record<string, Omit<Definition, "label">> = {
  production: { icon: RocketIcon, variant: "success" },
  prod: { icon: RocketIcon, variant: "success" },
  staging: { icon: FlaskConicalIcon, variant: "warning" },
  stage: { icon: FlaskConicalIcon, variant: "warning" },
  development: { icon: WrenchIcon, variant: "info" },
  dev: { icon: WrenchIcon, variant: "info" },
  preview: { icon: TagIcon, variant: "secondary" },
};

const renderBadge = (
  { label, icon: Icon, variant }: Definition,
  size: BadgeSize | undefined,
  className: string | undefined,
): ReactElement => (
  <Badge variant={variant} size={size} className={className}>
    <Icon strokeWidth={2} data-icon="inline-start" />
    {label}
  </Badge>
);

export const PlatformBadge = ({
  platform,
  size,
  className,
}: AttributeBadgeProps & { platform: PlatformValue }): ReactElement =>
  renderBadge(PLATFORM_DEFS[platform], size, className);

export const DistributionBadge = ({
  distribution,
  size,
  className,
}: AttributeBadgeProps & { distribution: BuildDistribution }): ReactElement =>
  renderBadge(DISTRIBUTION_DEFS[distribution], size, className);

export const ChannelBadge = ({
  name,
  size,
  className,
}: AttributeBadgeProps & { name: string }): ReactElement => (
  <Badge variant="outline" size={size} className={className}>
    <SatelliteIcon strokeWidth={2} data-icon="inline-start" />
    {name}
  </Badge>
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
