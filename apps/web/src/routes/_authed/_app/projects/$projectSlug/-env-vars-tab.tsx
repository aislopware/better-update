import { EnvVarsView } from "../../environment-variables/-env-vars-view";

export const EnvVarsTab = ({ orgId, projectId }: { orgId: string; projectId: string }) => (
  <EnvVarsView mode={{ kind: "project", orgId, projectId }} />
);
