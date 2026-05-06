import { queryOptions } from "@tanstack/react-query";

import type {
  CreateRegistrationRequestBody,
  RegisterDeviceBody,
  UpdateDeviceBody,
} from "@better-update/api";

import { runApi } from "../index";

import type { DeviceClassValue } from "./types";

export const devicesQueryKey = (orgId: string) => ["org", orgId, "devices"] as const;

export type DeviceSortColumn = "name" | "createdAt" | "deviceClass";

/** Sort param: column name optionally prefixed with `-` for descending. */
export type DeviceSort = DeviceSortColumn | `-${DeviceSortColumn}`;

export interface DevicesFilters {
  readonly deviceClass?: DeviceClassValue;
  readonly appleTeamId?: string;
  readonly page?: number;
  readonly limit?: number;
  readonly query?: string;
  readonly sort?: DeviceSort;
}

export const devicesQueryOptions = (orgId: string, filters?: DevicesFilters) =>
  queryOptions({
    queryKey: [...devicesQueryKey(orgId), filters ?? {}],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.devices.list({
            urlParams: {
              ...(filters?.deviceClass ? { deviceClass: filters.deviceClass } : {}),
              ...(filters?.appleTeamId ? { appleTeamId: filters.appleTeamId } : {}),
              ...(filters?.page === undefined ? {} : { page: filters.page }),
              ...(filters?.limit === undefined ? {} : { limit: filters.limit }),
              ...(filters?.query ? { query: filters.query } : {}),
              ...(filters?.sort ? { sort: filters.sort } : {}),
            },
          }),
        signal,
      ),
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
