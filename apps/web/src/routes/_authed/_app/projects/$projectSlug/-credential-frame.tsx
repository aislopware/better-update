import { Frame, FrameHeader, FramePanel, FrameTitle } from "@better-update/ui/components/ui/frame";

import type { ReactNode } from "react";

// FrameHeader's default px-5 aligns with FramePanel content (p-5); these frames
// hold a card-variant table whose column text sits on the px-2.5 rail, so the
// title and empty panel match that rail instead.
export const CredentialFrame = ({ title, children }: { title: string; children: ReactNode }) => (
  <Frame>
    <FrameHeader className="px-2.5">
      <FrameTitle>{title}</FrameTitle>
    </FrameHeader>
    {children}
  </Frame>
);

export const EmptyBindingPanel = ({ message }: { message: string }) => (
  <FramePanel className="px-2.5 py-4">
    <span className="text-muted-foreground text-sm">{message}</span>
  </FramePanel>
);
