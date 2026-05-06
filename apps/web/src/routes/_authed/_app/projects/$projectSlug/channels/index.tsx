import { createFileRoute } from "@tanstack/react-router";

import { ChannelsTab } from "../-channels-tab";

const ChannelsPage = () => {
  const { activeOrg, project } = Route.useRouteContext();

  return <ChannelsTab orgId={activeOrg.id} projectId={project.id} projectSlug={project.slug} />;
};

export const Route = createFileRoute("/_authed/_app/projects/$projectSlug/channels/")({
  component: ChannelsPage,
});
