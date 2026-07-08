const parseBrowser = (ua: string): string | undefined => {
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
  return undefined;
};

const parseOS = (ua: string): string | undefined => {
  if (ua.includes("Android")) {
    return "Android";
  }
  if (ua.includes("iPhone") || ua.includes("iPad")) {
    return "iOS";
  }
  if (ua.includes("Mac OS X")) {
    return "macOS";
  }
  if (ua.includes("Windows")) {
    return "Windows";
  }
  if (ua.includes("Linux")) {
    return "Linux";
  }
  return undefined;
};

// Degrade gracefully: "Chrome on macOS" → "Chrome" → "macOS" → "Unknown device",
// never the double-unknown "Unknown browser on Unknown OS".
export const parseUserAgent = (ua: string): string => {
  const browser = parseBrowser(ua);
  const os = parseOS(ua);
  if (browser && os) {
    return `${browser} on ${os}`;
  }
  return browser ?? os ?? "Unknown device";
};
