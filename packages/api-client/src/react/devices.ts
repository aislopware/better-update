import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type {
  CreateRegistrationRequestBody,
  RegisterDeviceBody,
  UpdateDeviceBody,
} from "@better-update/api";

import { runApi } from "../index";

import type { DeviceClassValue } from "./types";

export const devicesQueryKey = (orgId: string) => ["org", orgId, "devices"] as const;

export interface DevicesFilters {
  readonly deviceClass?: DeviceClassValue;
  readonly appleTeamId?: string;
  readonly limit?: number;
  readonly query?: string;
}

export const devicesInfiniteQueryOptions = (orgId: string, filters?: DevicesFilters) =>
  infiniteQueryOptions({
    queryKey: [...devicesQueryKey(orgId), filters ?? {}],
    queryFn: async ({ signal, pageParam }) =>
      runApi(
        (api) =>
          api.devices.list({
            urlParams: {
              ...(filters?.deviceClass ? { deviceClass: filters.deviceClass } : {}),
              ...(filters?.appleTeamId ? { appleTeamId: filters.appleTeamId } : {}),
              ...(filters?.limit ? { limit: filters.limit } : {}),
              ...(filters?.query ? { query: filters.query } : {}),
              cursor: pageParam,
            },
          }),
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      // eslint-disable-next-line eslint-js/no-restricted-syntax -- react-query getNextPageParam contract: undefined terminates; API schema returns null
      lastPage.nextCursor ?? undefined,
    staleTime: 30_000,
  });

export const registerDevice = async (body: typeof RegisterDeviceBody.Type) =>
  runApi((api) => api.devices.register({ payload: body }));

export const updateDevice = async (id: string, body: typeof UpdateDeviceBody.Type) =>
  runApi((api) => api.devices.update({ path: { id }, payload: body }));

export const deleteDevice = async (id: string) =>
  runApi((api) => api.devices.delete({ path: { id } }));

export const registrationRequestsQueryKey = (orgId: string) =>
  ["org", orgId, "device-registration-requests"] as const;

export const registrationRequestsQueryOptions = (orgId: string, activeOnly = true) =>
  queryOptions({
    queryKey: [...registrationRequestsQueryKey(orgId), { activeOnly }],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.devices.listRegistrationRequests({
            urlParams: { active: activeOnly ? "true" : "false" },
          }),
        signal,
      ),
    staleTime: 15_000,
  });

export const createRegistrationRequest = async (body: typeof CreateRegistrationRequestBody.Type) =>
  runApi((api) => api.devices.createRegistrationRequest({ payload: body }));
