const parseBrowser = (ua: string): string => {
  if (ua.includes("Edg/")) {
    return "Edge";
  }
  if (ua.includes("Chrome/")) {
    return "Chrome";
  }
  if (ua.includes("Firefox/")) {
    return "Firefox";
  }
  if (ua.includes("Safari/") && ua.includes("Version/")) {
    return "Safari";
  }
  return "Unknown browser";
};

const parseOS = (ua: string): string => {
  if (ua.includes("Mac OS X")) {
    return "macOS";
  }
  if (ua.includes("Windows")) {
    return "Windows";
  }
  if (ua.includes("Linux")) {
    return "Linux";
  }
  if (ua.includes("Android")) {
    return "Android";
  }
  if (ua.includes("iPhone") || ua.includes("iPad")) {
    return "iOS";
  }
  return "Unknown OS";
};

export const parseUserAgent = (ua: string): string => `${parseBrowser(ua)} on ${parseOS(ua)}`;
