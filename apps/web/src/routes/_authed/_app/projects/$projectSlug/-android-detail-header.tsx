import { Link } from "@tanstack/react-router";

import { AndroidIcon } from "../../../../../components/android-icon";
import { DetailHeader, DetailNotFound } from "../../../../../components/detail-header";

// `projectSlug` stays in the props type for the caller; the shell breadcrumb
// now covers the route, so the header itself no longer links back.
export const AndroidDetailHeader = ({
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  <DetailHeader
    title={<span className="font-mono">{packageName}</span>}
    meta={
      <span className="inline-flex items-center gap-1.5">
        <AndroidIcon className="size-3.5" />
        Application Identifier
      </span>
    }
  />
);

export const AndroidNotFoundEmpty = ({
  projectSlug,
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  <DetailNotFound
    icon={<AndroidIcon />}
    title="Application identifier not found"
    description={
      <>
        No identifier exists for <code className="text-foreground font-mono">{packageName}</code> on
        this project.
      </>
    }
    backLink={<Link to="/projects/$projectSlug/credentials" params={{ projectSlug }} />}
    backLabel="Back to credentials"
  />
);
