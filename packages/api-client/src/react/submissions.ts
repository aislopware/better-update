import { compact } from "@better-update/type-guards";
import { queryOptions } from "@tanstack/react-query";

import type { CreateSubmissionBody, Platform } from "@better-update/api";

import { runApi } from "../index";

export interface SubmissionsFilters {
  readonly page?: number;
  readonly limit?: number;
  readonly platform?: typeof Platform.Type;
  readonly profile?: string;
  readonly buildId?: string;
}

const buildUrlParams = (filters: SubmissionsFilters | undefined) => {
  if (filters === undefined) {
    return {};
  }
  return compact({
    page: filters.page,
    limit: filters.limit,
    platform: filters.platform,
    profile: filters.profile,
    buildId: filters.buildId,
  });
};

export const submissionsQueryKey = (
  orgId: string,
  projectId: string,
  filters?: SubmissionsFilters,
) => ["org", orgId, "projects", projectId, "submissions", filters ?? {}] as const;

export const submissionsQueryOptions = (
  orgId: string,
  projectId: string,
  filters?: SubmissionsFilters,
) =>
  queryOptions({
    queryKey: submissionsQueryKey(orgId, projectId, filters),
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.submissions.list({
            path: { projectId },
            urlParams: buildUrlParams(filters),
          }),
        signal,
      ),
    staleTime: 15_000,
  });

export const submissionQueryKey = (orgId: string, submissionId: string) =>
  ["org", orgId, "submissions", submissionId] as const;

export const submissionQueryOptions = (orgId: string, submissionId: string) =>
  queryOptions({
    queryKey: submissionQueryKey(orgId, submissionId),
    queryFn: async ({ signal }) =>
      runApi((api) => api.submissions.get({ path: { id: submissionId } }), signal),
    staleTime: 5000,
  });

export const createSubmission = async (projectId: string, body: typeof CreateSubmissionBody.Type) =>
  runApi((api) => api.submissions.create({ path: { projectId }, payload: body }));

export const deleteSubmission = async (submissionId: string) =>
  runApi((api) => api.submissions.delete({ path: { id: submissionId } }));
