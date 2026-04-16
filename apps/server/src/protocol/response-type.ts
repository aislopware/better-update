export type ResponseType = "manifest" | "directive" | "no_update";

export const isResponseType = (value: string | null): value is ResponseType =>
  value === "manifest" || value === "directive" || value === "no_update";
