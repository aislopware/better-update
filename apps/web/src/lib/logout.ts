import type { QueryClient } from "@tanstack/react-query";

import { authClient } from "./auth-client";

const CHANNEL_NAME = "better-update-auth";
const SIGNOUT_MESSAGE = "signout";

const LOGIN_PATH = "/auth/login";

const goToLogin = (): void => {
  globalThis.location.assign(LOGIN_PATH);
};

const clearAuthQueries = (queryClient: QueryClient): void => {
  queryClient.removeQueries({ queryKey: ["auth"] });
};

const getChannel = (): BroadcastChannel | null =>
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME);

export const logout = async (queryClient: QueryClient): Promise<void> => {
  await authClient.signOut();
  clearAuthQueries(queryClient);
  const channel = getChannel();
  if (channel) {
    // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel.postMessage takes no targetOrigin arg; rule is tuned for window.postMessage
    channel.postMessage(SIGNOUT_MESSAGE);
    channel.close();
  }
  goToLogin();
};

export const subscribeToSignoutBroadcast = (queryClient: QueryClient): (() => void) => {
  const channel = getChannel();
  if (!channel) {
    return () => undefined;
  }
  const handler = (event: MessageEvent<unknown>): void => {
    if (event.data === SIGNOUT_MESSAGE) {
      clearAuthQueries(queryClient);
      goToLogin();
    }
  };
  channel.addEventListener("message", handler);
  return () => {
    channel.removeEventListener("message", handler);
    channel.close();
  };
};
