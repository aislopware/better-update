import { cn } from "@better-update/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import type { LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type LinkTo = Exclude<LinkProps["to"], undefined>;

interface SettingsNavItem {
  readonly to: LinkTo;
  readonly label: string;
  readonly icon: LucideIcon;
}

interface SettingsNavSection {
  readonly label?: string;
  readonly items: readonly SettingsNavItem[];
}

interface SettingsLayoutProps {
  readonly nav: readonly SettingsNavSection[];
  readonly children: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

export const SettingsLayout = ({
  nav,
  children,
  title,
  description,
  actions,
}: SettingsLayoutProps) => (
  <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-10">
    <aside className="lg:w-56 lg:shrink-0">
      <nav className="flex flex-col gap-6 lg:sticky lg:top-20">
        {nav.map((section, sectionIdx) => (
          <div key={section.label ?? sectionIdx} className="flex flex-col gap-1">
            {section.label ? (
              <p className="text-muted-foreground/72 px-2 text-xs font-medium tracking-wider uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="flex flex-col">
              {section.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    activeOptions={{ exact: true }}
                    className={cn(
                      "group/settings-nav-item flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      "text-muted-foreground hover:bg-muted hover:text-foreground",
                      "data-status-active:bg-muted data-status-active:text-foreground data-status-active:font-medium",
                    )}
                  >
                    <item.icon
                      strokeWidth={2}
                      className="size-4 opacity-72 group-data-status-active/settings-nav-item:opacity-100"
                    />
                    <span>{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
    <div className="min-w-0 flex-1">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </h1>
          {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  </div>
);

export type { SettingsNavItem, SettingsNavSection };
