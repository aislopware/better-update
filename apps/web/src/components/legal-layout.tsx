import { Button } from "@better-update/ui/components/ui/button";
import { Link } from "@tanstack/react-router";

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
    <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
      {block.items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  ) : (
    <p className="text-muted-foreground text-sm leading-relaxed">{block.text}</p>
  );

const SectionView = ({ section }: { readonly section: LegalSectionData }) => (
  <section className="flex flex-col gap-3">
    <h2 className="font-heading text-foreground text-lg font-semibold tracking-tight">
      {section.heading}
    </h2>
    {section.blocks.map((block) => (
      <BlockView key={blockKey(block)} block={block} />
    ))}
  </section>
);

const LegalHeader = () => (
  <header className="border-border/60 border-b">
    <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-6 py-5">
      <Link to="/">
        <BrandWordmark iconSize={32} />
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link
          to="/terms"
          className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
        >
          Terms
        </Link>
        <Link
          to="/privacy"
          className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
        >
          Privacy
        </Link>
        <Button size="sm" render={<Link to="/auth/login" />}>
          Sign in
        </Button>
      </nav>
    </div>
  </header>
);

const LegalFooter = () => (
  <footer className="border-border/60 mt-2 flex flex-col gap-3 border-t pt-8">
    <p className="text-muted-foreground text-sm leading-relaxed">
      Questions about this page? Email{" "}
      <a
        href="mailto:legal@better-update.dev"
        className="text-foreground underline-offset-4 hover:underline"
      >
        legal@better-update.dev
      </a>
      .
    </p>
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <Link to="/terms" className="text-foreground underline-offset-4 hover:underline">
        Terms of Service
      </Link>
      <Link to="/privacy" className="text-foreground underline-offset-4 hover:underline">
        Privacy Policy
      </Link>
      <Link to="/auth/login" className="text-muted-foreground underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  </footer>
);

export const LegalLayout = ({ title, lastUpdated, intro, sections }: LegalLayoutProps) => (
  <div className="bg-background min-h-dvh">
    <LegalHeader />
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-12 sm:py-16">
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-muted-foreground text-sm">Last updated {lastUpdated}</p>
        <p className="text-muted-foreground text-sm leading-relaxed">{intro}</p>
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
