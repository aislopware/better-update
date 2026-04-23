import { Button } from "@better-update/ui/components/ui/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";

import { BrandWordmark } from "../../components/brand-mark";
import { HeroMotion } from "../../components/hero-motion";
import { authClient } from "../../lib/auth-client";

const SEARCH_KEYS = { redirectTo: "redirectTo" } as const;

interface LoginSearch {
  readonly redirectTo?: string;
}

const readRedirectTo = (search: LoginSearch): string => search.redirectTo ?? "/";

const CheckIcon = ({ className }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8.5 L6.5 12 L13 4.5" />
  </svg>
);

const ArrowIcon = ({ className }: { readonly className?: string }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 8 H13 M9 4 L13 8 L9 12" />
  </svg>
);

const GithubIcon = ({ className }: { readonly className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
  </svg>
);

const LeftHero = () => (
  <section className="border-border/60 relative flex min-h-[38dvh] flex-col overflow-hidden border-b lg:min-h-dvh lg:border-r lg:border-b-0">
    <div className="relative mx-auto flex h-full w-full max-w-[1180px] flex-1 flex-col">
      <HeroMotion />
      <div className="pointer-events-none relative z-10 flex h-full flex-col justify-between gap-10 px-8 pt-8 pb-8 sm:px-12 lg:px-16 lg:pt-12 lg:pb-12">
        <BrandWordmark />
        <HeroHeadline />
        <HeroMeta />
      </div>
    </div>
  </section>
);

const HeroHeadline = () => (
  <div className="hidden max-w-[22ch] flex-col gap-3 lg:flex">
    <h1 className="font-heading text-foreground text-3xl leading-[1.1] font-semibold tracking-tight text-balance xl:text-4xl">
      Ship updates at the speed of code.
    </h1>
    <p className="text-muted-foreground max-w-[32ch] text-sm leading-relaxed">
      Over-the-air delivery for React Native, across 330+ edge cities in 125+ countries.
    </p>
  </div>
);

const HeroMeta = () => (
  <div className="hidden flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] tracking-wide lg:flex">
    <LiveIndicator />
    <span className="text-border" aria-hidden="true">
      ·
    </span>
    <span className="text-muted-foreground">330+ edge cities</span>
    <span className="text-border" aria-hidden="true">
      ·
    </span>
    <span className="text-muted-foreground">99.99% SLA</span>
  </div>
);

const LiveIndicator = () => (
  <span className="inline-flex items-center gap-2">
    <span className="relative flex size-1.5">
      <span className="bg-primary absolute inline-flex size-full animate-ping rounded-full opacity-75" />
      <span className="bg-primary relative inline-flex size-full rounded-full" />
    </span>
    <span className="text-muted-foreground uppercase">Live</span>
  </span>
);

interface AuthPanelProps {
  readonly onGithub: () => void | Promise<void>;
  readonly isPending: boolean;
}

const AuthPanel = ({ onGithub, isPending }: AuthPanelProps) => (
  <section className="bg-background/60 relative flex items-center justify-center px-6 py-12 backdrop-blur-sm sm:px-10 lg:px-12">
    <div className="flex w-full max-w-sm flex-col gap-8">
      <AuthHeader />
      <div className="flex flex-col gap-3">
        <GithubButton onClick={onGithub} isPending={isPending} />
      </div>
      <SecureDivider />
      <TrustPoints />
      <LegalFootnote />
    </div>
  </section>
);

const AuthHeader = () => (
  <div className="flex flex-col gap-2">
    <h2 className="font-heading text-foreground text-3xl leading-tight font-semibold tracking-tight">
      Welcome back
    </h2>
    <p className="text-muted-foreground text-sm leading-relaxed">
      Sign in to continue shipping updates to your users.
    </p>
  </div>
);

interface GithubButtonProps {
  readonly onClick: () => void | Promise<void>;
  readonly isPending: boolean;
}

const GithubButton = ({ onClick, isPending }: GithubButtonProps) => (
  <Button
    size="lg"
    className="group relative h-12 w-full gap-2.5 text-sm font-medium"
    onClick={onClick}
    disabled={isPending}
    aria-busy={isPending}
  >
    {isPending ? (
      <>
        <Loader2Icon className="size-5 animate-spin" />
        Connecting to GitHub…
      </>
    ) : (
      <>
        <GithubIcon className="size-5" />
        Continue with GitHub
        <ArrowIcon className="size-4 opacity-70 transition-[transform,opacity] duration-200 ease-out pointer-fine:group-hover:translate-x-0.5 pointer-fine:group-hover:opacity-100" />
      </>
    )}
  </Button>
);

const SecureDivider = () => (
  <div className="flex items-center gap-3">
    <span className="border-border/60 flex-1 border-t" />
    <span className="text-muted-foreground text-[0.7rem] tracking-wider uppercase">
      Secure by default
    </span>
    <span className="border-border/60 flex-1 border-t" />
  </div>
);

const TRUST_POINTS = [
  "Signed tokens, short-lived sessions.",
  "SOC 2 controls, audit log on every change.",
] as const;

const TrustPoints = () => (
  <ul className="text-muted-foreground flex flex-col gap-2 text-xs leading-relaxed">
    {TRUST_POINTS.map((text) => (
      <li key={text} className="flex items-center gap-2">
        <CheckIcon className="text-primary size-3.5" />
        {text}
      </li>
    ))}
  </ul>
);

const LegalFootnote = () => (
  <p className="text-muted-foreground max-w-[38ch] text-[0.7rem] leading-relaxed">
    By continuing you agree to our{" "}
    <a href="/terms" className="text-foreground underline-offset-4 hover:underline">
      Terms of Service
    </a>{" "}
    and{" "}
    <a href="/privacy" className="text-foreground underline-offset-4 hover:underline">
      Privacy Policy
    </a>
    .
  </p>
);

const LoginPage = () => {
  const search = Route.useSearch();
  const [isPending, setIsPending] = useState(false);

  const signInWithGithub = async () => {
    setIsPending(true);
    const redirectTo = readRedirectTo(search);
    const { error } = await authClient.signIn.social({
      provider: "github",
      callbackURL: `${globalThis.location.origin}${redirectTo}`,
    });
    if (error) {
      setIsPending(false);
    }
  };

  return (
    <div className="bg-background relative min-h-dvh overflow-hidden">
      <div className="relative grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
        <LeftHero />
        <AuthPanel onGithub={signInWithGithub} isPending={isPending} />
      </div>
    </div>
  );
};

const isSafeRedirect = (value: string): boolean =>
  value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\");

export const Route = createFileRoute("/auth/login")({
  validateSearch: (search): LoginSearch => {
    const raw = search[SEARCH_KEYS.redirectTo];
    const safe = typeof raw === "string" && isSafeRedirect(raw) ? raw : "/";
    return { redirectTo: safe };
  },
  beforeLoad: ({ context, search }) => {
    if (context.session?.user) {
      // eslint-disable-next-line functional/no-throw-statements, typescript/only-throw-error -- TanStack Router idiom: throw redirect preserves typed search-param inference
      throw redirect({ href: search.redirectTo ?? "/" });
    }
  },
  component: LoginPage,
});
