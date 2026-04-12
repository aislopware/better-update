import { Badge } from "@better-update/ui/components/ui/badge";
import { Button } from "@better-update/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@better-update/ui/components/ui/card";
import { Download04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { BuildWithArtifact } from "@better-update/api";

import { formatBytes } from "./-build-helpers";
import { DeleteBuildDialog } from "./-delete-build-dialog";

export const BuildCard = ({
  build,
  orgId,
  projectId,
}: {
  build: typeof BuildWithArtifact.Type;
  orgId: string;
  projectId: string;
}) => (
  <Card>
    <CardHeader className="pb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">
            {(build.message ?? build.profile) || `Build ${build.id.slice(0, 8)}`}
          </CardTitle>
          <Badge variant="outline">{build.platform}</Badge>
          <Badge variant="secondary">{build.distribution}</Badge>
          {build.artifact && <Badge variant="outline">{build.artifact.format.toUpperCase()}</Badge>}
        </div>
        <div className="flex items-center gap-1">
          {build.artifact && (
            <a href={`/api/builds/${build.id}/artifact`}>
              <Button variant="ghost" size="icon" className="size-8" title="Download artifact">
                <HugeiconsIcon icon={Download04Icon} strokeWidth={2} className="size-4" />
              </Button>
            </a>
          )}
          <DeleteBuildDialog build={build} orgId={orgId} projectId={projectId} />
        </div>
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {build.runtimeVersion && <span>v{build.runtimeVersion}</span>}
        {build.appVersion && <span>App {build.appVersion}</span>}
        {build.buildNumber && <span>#{build.buildNumber}</span>}
        {build.gitRef && <span className="font-mono text-xs">{build.gitRef}</span>}
        {build.artifact && <span>{formatBytes(build.artifact.byteSize)}</span>}
        <span>{new Date(build.createdAt).toLocaleString()}</span>
      </div>
    </CardContent>
  </Card>
);
