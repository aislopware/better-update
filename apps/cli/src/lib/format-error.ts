export const formatCause = (cause: unknown): string => {
  if (cause instanceof Error) {
    return cause.message;
  }

  if (typeof cause === "object" && cause !== null) {
    const tagged = cause as { readonly _tag?: unknown; readonly message?: unknown };
    const tag = typeof tagged._tag === "string" ? tagged._tag : undefined;
    const message = typeof tagged.message === "string" ? tagged.message : undefined;
    if (tag && message) return `${tag}: ${message}`;
    if (message) return message;
    if (tag) return tag;
  }

  return String(cause);
};
