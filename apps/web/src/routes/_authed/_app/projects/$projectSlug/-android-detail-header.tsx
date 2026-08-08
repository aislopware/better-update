import { AndroidIcon } from "../../../../../components/android-icon";
import { DetailHeader, DetailNotFound } from "../../../../../components/detail-header";
import { RouterLinkButton } from "../../../../../lib/router-link-button";

// `projectSlug` stays in the props type for the caller; the shell breadcrumb
// now covers the route, so the header itself no longer links back.
export const AndroidDetailHeader = ({
  packageName,
}: {
  projectSlug: string;
  packageName: string;
}) => (
  // No meta line: the breadcrumb above already reads Credentials › Android, and
  // "Application Identifier" under a package name only names its own format.
  <DetailHeader title={<span className="font-mono">{packageName}</span>} />
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
    description={`No identifier exists for ${packageName} on this project.`}
    backLink={
      <RouterLinkButton to="/projects/$projectSlug/credentials" params={{ projectSlug }}>
        Back to credentials
      </RouterLinkButton>
    }
  />
);
