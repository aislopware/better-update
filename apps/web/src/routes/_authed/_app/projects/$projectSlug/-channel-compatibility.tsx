import type { MissingRuntimeVersionBuild } from "@better-update/api";

export const MissingMatchingBuilds = ({
  missingRuntimeVersions,
}: {
  missingRuntimeVersions: readonly MissingRuntimeVersionBuild[];
}) => {
  if (missingRuntimeVersions.length === 0) {
    return null;
  }

  return (
    <div className="bg-muted/40 border-border rounded-3xl border p-4">
      <div className="mb-2 text-sm font-medium">Missing matching builds</div>
      <div className="flex flex-col gap-2">
        {missingRuntimeVersions.map((entry) => (
          <div
            key={`${entry.channelId}:${entry.platform}:${entry.runtimeVersion}`}
            className="text-sm"
          >
            <span className="font-medium">
              {entry.platform} v{entry.runtimeVersion}
            </span>
            <span className="text-muted-foreground">
              {" "}
              has {entry.updateCount} updates but no uploaded build.
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
