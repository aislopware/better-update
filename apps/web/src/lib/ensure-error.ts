export const ensureError = (err: unknown, fallbackMessage: string): Error => {
  if (err instanceof Error) {
    return err;
  }
  if (typeof err === "string" && err.length > 0) {
    return new Error(err);
  }
  return new Error(fallbackMessage);
};
