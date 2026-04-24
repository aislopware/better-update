import { getPlistString, parsePlistXml } from "./plist";

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Build an unsigned Apple Configuration Profile (.mobileconfig) XML payload
 * that requests device attributes via "Profile Service".
 * Safari iOS warns "Unverified" on unsigned profiles but still allows install.
 */
export const buildDeviceRegistrationProfile = (params: {
  readonly requestId: string;
  readonly callbackUrl: string;
  readonly organization: string;
  readonly profileUuid: string;
}): string => {
  const challenge = params.requestId;
  const payloadIdentifier = `com.better-update.device-registration.${params.requestId}`;
  const description = "Install this profile to register your device for ad-hoc testing.";
  const displayName = "Device Registration";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <dict>
    <key>URL</key>
    <string>${escape(params.callbackUrl)}</string>
    <key>DeviceAttributes</key>
    <array>
      <string>UDID</string>
      <string>PRODUCT</string>
      <string>VERSION</string>
      <string>SERIAL</string>
      <string>DEVICE_NAME</string>
    </array>
    <key>Challenge</key>
    <string>${escape(challenge)}</string>
  </dict>
  <key>PayloadDescription</key>
  <string>${escape(description)}</string>
  <key>PayloadDisplayName</key>
  <string>${escape(displayName)}</string>
  <key>PayloadIdentifier</key>
  <string>${escape(payloadIdentifier)}</string>
  <key>PayloadOrganization</key>
  <string>${escape(params.organization)}</string>
  <key>PayloadType</key>
  <string>Profile Service</string>
  <key>PayloadUUID</key>
  <string>${escape(params.profileUuid)}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>`;
};

/**
 * Extract the top-level `<dict>` key/string pairs from an iOS profile service
 * callback plist body. Returns a plain record. Ignores non-string values.
 */
export const parseProfileCallbackPlist = (body: string): Record<string, string> => {
  const parsed = parsePlistXml(body);
  if (parsed === null) {
    return {};
  }
  return Object.fromEntries(
    Object.keys(parsed).flatMap((key) => {
      const value = getPlistString(parsed, key);
      return value === null ? [] : [[key, value] as const];
    }),
  );
};

export const renderRegistrationLandingHtml = (params: {
  readonly profileUrl: string;
  readonly deviceNameHint: string | null;
  readonly expiresAt: string;
}): string => {
  const hint = params.deviceNameHint ?? "your device";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Register device</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 24px; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { color: #555; }
  .btn { display: inline-block; padding: 12px 20px; background: #0a7aff; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; margin-top: 16px; }
  .muted { color: #888; font-size: 13px; margin-top: 24px; }
</style>
</head>
<body>
<h1>Register ${escape(hint)}</h1>
<p>Tap the button below on an iOS device to install a profile that registers this device for ad-hoc builds.</p>
<a class="btn" href="${escape(params.profileUrl)}">Install profile</a>
<p class="muted">Link expires ${escape(new Date(params.expiresAt).toLocaleString())}. Safari will show "Not Verified" — that is expected for internal enrollment.</p>
</body>
</html>`;
};

export const renderRegistrationDoneHtml = (deviceName: string): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Device registered</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 24px;line-height:1.5;}h1{font-size:22px;}</style>
</head>
<body>
<h1>Device registered</h1>
<p>${escape(deviceName)} has been added. You can close this window.</p>
</body>
</html>`;

export const renderRegistrationErrorHtml = (message: string): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Registration error</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 24px;line-height:1.5;}h1{font-size:22px;color:#c00;}</style>
</head>
<body>
<h1>Registration failed</h1>
<p>${escape(message)}</p>
</body>
</html>`;
