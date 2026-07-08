import type { ReactNode } from "react";

import { SectionHeader } from "../../../../../components/page-header";

export const CredentialSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="flex flex-col gap-3">
    <SectionHeader title={title} />
    <div className="overflow-hidden rounded-md border">{children}</div>
  </section>
);

export const EmptyBindingMessage = ({ message }: { message: string }) => (
  <p className="text-muted-foreground px-3 py-4 text-sm">{message}</p>
);
