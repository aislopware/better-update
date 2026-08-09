import { LinkButton } from "@better-update/ui/components/button";
import { Link as KumoLink } from "@better-update/ui/components/link";
import { Link } from "@tanstack/react-router";

import { RouterLink } from "../lib/resource-link";
import { SITE } from "../lib/site-config";
import { BrandWordmark } from "./brand-mark";

export type LegalBlock =
  | { readonly kind: "p"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] };

export interface LegalSectionData {
  readonly heading: string;
  readonly blocks: readonly LegalBlock[];
}

interface LegalLayoutProps {
  readonly title: string;
  readonly lastUpdated: string;
  readonly intro: string;
  readonly sections: readonly LegalSectionData[];
}

const blockKey = (block: LegalBlock): string =>
  block.kind === "list" ? block.items.join("|") : block.text;

const BlockView = ({ block }: { readonly block: LegalBlock }) =>
  block.kind === "list" ? (
    <ul className="text-kumo-subtle flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="text-kumo-subtle text-sm leading-relaxed">{block.text}</p>
  );

const SectionView = ({ section }: { readonly section: LegalSectionData }) => (
  <section className="flex flex-col gap-3">
    <h2 className="font-heading text-kumo-default text-lg font-semibold tracking-tight">
      {section.heading}
    </h2>
    {section.blocks.map((block) => (
      <BlockView key={blockKey(block)} block={block} />
    ))}
  </section>
);

const LegalHeader = () => (
  <header className="border-kumo-line/60 border-b">
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-5">
      <Link to="/">
        <BrandWordmark iconSize={32} />
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link to="/terms" className="text-kumo-subtle hover:text-kumo-default hidden sm:inline">
          Terms
        </Link>
        <Link to="/privacy" className="text-kumo-subtle hover:text-kumo-default hidden sm:inline">
          Privacy
        </Link>
        <LinkButton variant="primary" size="sm" href="/auth/login">
          Sign in
        </LinkButton>
      </nav>
    </div>
  </header>
);

const LegalFooter = () => (
  <footer className="border-kumo-line/60 mt-2 flex flex-col gap-3 border-t pt-8">
    <p className="text-kumo-subtle text-sm leading-relaxed">
      {/* Kumo's `current` variant: a link that takes the colour of the sentence
          around it and is underlined all the time. The hand-rolled version this
          replaced only underlined on hover, which left a link in body text with
          nothing at all to mark it for anyone who is not already pointing at
          it. */}
      Questions about this page? Email{" "}
      <KumoLink variant="current" href={`mailto:${SITE.legalEmail}`}>
        {SITE.legalEmail}
      </KumoLink>
      .
    </p>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <RouterLink variant="current" to="/terms">
        Terms of Service
      </RouterLink>
      <RouterLink variant="current" to="/privacy">
        Privacy Policy
      </RouterLink>
      <RouterLink variant="current" to="/auth/login" className="text-kumo-subtle">
        Back to sign in
      </RouterLink>
    </div>
  </footer>
);

export const LegalLayout = ({ title, lastUpdated, intro, sections }: LegalLayoutProps) => (
  <div className="bg-kumo-canvas min-h-dvh">
    <LegalHeader />
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12 sm:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-kumo-default text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-kumo-subtle text-sm">Last updated {lastUpdated}</p>
        <p className="text-kumo-subtle text-sm leading-relaxed">{intro}</p>
      </div>
      <div className="flex flex-col gap-8">
        {sections.map((section) => (
          <SectionView key={section.heading} section={section} />
        ))}
      </div>
      <LegalFooter />
    </main>
  </div>
);
