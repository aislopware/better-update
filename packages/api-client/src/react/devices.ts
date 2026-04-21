import { queryOptions } from "@tanstack/react-query";

import type {
  CreateRegistrationRequestBody,
  RegisterDeviceBody,
  UpdateDeviceBody,
} from "@better-update/api";

import { runApi } from "../index";

import type { DeviceClassValue } from "./types";

export const devicesQueryKey = (orgId: string) => ["org", orgId, "devices"] as const;

export const devicesQueryOptions = (
  orgId: string,
  filters?: {
    page?: number;
    limit?: number;
    search?: string;
    deviceClass?: DeviceClassValue;
    appleTeamId?: string;
  },
) =>
  queryOptions({
    queryKey: [
      ...devicesQueryKey(orgId),
      {
        page: filters?.page,
        limit: filters?.limit,
        search: filters?.search,
        deviceClass: filters?.deviceClass,
        appleTeamId: filters?.appleTeamId,
      },
    ],
    queryFn: async ({ signal }) =>
      runApi(
        (api) =>
          api.devices.list({
            urlParams: {
              page: filters?.page,
              limit: filters?.limit,
              search: filters?.search,
              deviceClass: filters?.deviceClass,
              appleTeamId: filters?.appleTeamId,
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
