import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@better-update/ui/components/ui/card";

import type { MissingRuntimeVersionBuild } from "@better-update/api";

import { PlatformBadge } from "../../../../../components/attribute-badges";
import { pluralize } from "../../../../../lib/pluralize";

export const MissingMatchingBuilds = ({
  missingRuntimeVersions,
}: {
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => {
  if (missingRuntimeVersions.length === 0) {
    return null;
  }

  return (
    <Card className="border-border bg-muted/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Missing matching builds</CardTitle>
        <CardDescription>
          These runtime versions have OTA updates but no uploaded build.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {missingRuntimeVersions.map((entry) => (
          <div
            key={`${entry.channelId}:${entry.platform}:${entry.runtimeVersion}`}
            className="flex flex-wrap items-center gap-2 text-sm"
          >
            <PlatformBadge platform={entry.platform} />
            <span className="font-medium">v{entry.runtimeVersion}</span>
            <span className="text-muted-foreground">
              {entry.updateCount} {pluralize(entry.updateCount, "update")} but no uploaded build.
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
