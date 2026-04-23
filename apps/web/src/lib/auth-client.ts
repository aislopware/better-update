import { createBetterUpdateAuthClient } from "@better-update/auth-client";

// eslint-disable-next-line eslint-js/no-restricted-syntax -- Vite build-time env; empty fallback resolves auth calls against current origin (Vite `/api` proxy in dev, same-subdomain build in prod).
const baseUrl: string = import.meta.env.VITE_API_URL ?? "";

export const authClient = createBetterUpdateAuthClient(baseUrl);

export { rejectOnAuthClientError } from "@better-update/auth-client";
