import { queryOptions } from "@tanstack/react-query";

import type { CredentialBinding, CredentialBindingTypeValue } from "@better-update/api";

import { runApi } from "../index";

// Credential→project bindings (GITLAB-RBAC-SPEC §1a/§3c): which org
// credentials a project may use. Managed by org admins; `appleTeam` bindings
// cover every child credential + the team's devices.
export type CredentialBindingItem = typeof CredentialBinding.Type;

export const credentialBindingsQueryKey = (orgId: string, projectId: string) =>
  ["org", orgId, "project", projectId, "credential-bindings"] as const;

export const credentialBindingsQueryOptions = (orgId: string, projectId: string) =>
  queryOptions({
    queryKey: credentialBindingsQueryKey(orgId, projectId),
    queryFn: async ({ signal }) => {
      const result = await runApi(
        (api) => api["credential-bindings"].list({ path: { id: projectId } }),
        signal,
      );
      return result.items;
    },
    staleTime: 30_000,
  });

export const bindCredentialToProject = async (params: {
  readonly projectId: string;
  readonly resourceType: CredentialBindingTypeValue;
  readonly resourceId: string;
}) =>
  runApi((api) =>
    api["credential-bindings"].bind({
      path: {
        id: params.projectId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      },
    }),
  );

export const unbindCredentialFromProject = async (params: {
  readonly projectId: string;
  readonly resourceType: CredentialBindingTypeValue;
  readonly resourceId: string;
}) =>
  runApi((api) =>
    api["credential-bindings"].unbind({
      path: {
        id: params.projectId,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
      },
    }),
  );
