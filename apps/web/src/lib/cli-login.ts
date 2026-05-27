const CALLBACK_URL_PATTERN = /^http:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/[^\s]*)?$/u;

export const isAllowedCliCallbackUrl = (value: string): boolean => CALLBACK_URL_PATTERN.test(value);

export const buildCliCallbackRedirect = (callbackUrl: string, token: string): string => {
  const url = new URL(callbackUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/u, ""));
  hash.set("token", token);
  url.hash = hash.toString();
  return url.toString();
};

export const buildCliLoginRedirectTarget = (callbackUrl: string): string =>
  `/auth/cli-login?callbackUrl=${encodeURIComponent(callbackUrl)}`;
