import { queryOptions } from "@tanstack/react-query";

import type {
  CreateSubmissionBody,
  Platform,
  SubmissionStatus,
  UpdateSubmissionStatusBody,
} from "@better-update/api";

import { runApi } from "../index";

export interface SubmissionsFilters {
  readonly status?: typeof SubmissionStatus.Type;
  readonly platform?: typeof Platform.Type;
  readonly profile?: string;
  readonly buildId?: string;
}

interface UrlParams {
  readonly status?: typeof SubmissionStatus.Type;
  readonly platform?: typeof Platform.Type;
  readonly profile?: string;
  readonly buildId?: string;
}

const buildUrlParams = (filters: SubmissionsFilters | undefined): UrlParams => {
  if (filters === undefined) {
    return {};
  }
  return {
    ...(filters.status === undefined ? {} : { status: filters.status }),
    ...(filters.platform === undefined ? {} : { platform: filters.platform }),
    ...(filters.profile === undefined ? {} : { profile: filters.profile }),
    ...(filters.buildId === undefined ? {} : { buildId: filters.buildId }),
  };
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

export const updateSubmissionStatus = async (
  submissionId: string,
  body: typeof UpdateSubmissionStatusBody.Type,
) => runApi((api) => api.submissions.updateStatus({ path: { id: submissionId }, payload: body }));

export const cancelSubmission = async (submissionId: string) =>
  runApi((api) => api.submissions.cancel({ path: { id: submissionId } }));

export const deleteSubmission = async (submissionId: string) =>
  runApi((api) => api.submissions.delete({ path: { id: submissionId } }));
