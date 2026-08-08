import { cn } from "@better-update/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import type { Icon } from "@phosphor-icons/react";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

type LinkTo = Exclude<LinkProps["to"], undefined>;

interface SettingsNavItem {
  readonly to: LinkTo;
  readonly label: string;
  readonly icon: Icon;
}

interface SettingsNavSection {
  readonly label?: string;
  readonly items: readonly SettingsNavItem[];
}

interface SettingsLayoutProps {
  readonly nav: readonly SettingsNavSection[];
  readonly children: ReactNode;
}

/**
 * A settings section: its nav down the side, the page it points at beside it.
 *
 * The header used to live here, so every page under the nav was titled after
 * the section — five pages all called "Account", each of them describing the
 * other four. The nav says which one you picked; the header has to say which
 * one you are on, so each page writes its own.
 */
export const SettingsLayout = ({ nav, children }: SettingsLayoutProps) => (
  <div className="flex w-full flex-col gap-6 lg:flex-row lg:gap-10">
    <aside className="lg:w-56 lg:shrink-0">
      <nav className="flex flex-col gap-6 lg:sticky lg:top-20">
        {nav.map((section, sectionIdx) => (
          <div key={section.label ?? sectionIdx} className="flex flex-col gap-1">
            {section.label ? (
              <p className="text-kumo-subtle/72 px-2 text-xs font-medium tracking-wider uppercase">
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
                      "group/settings-nav-item flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm",
                      "text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default",
                      "data-status-active:bg-kumo-tint data-status-active:text-kumo-default data-status-active:font-medium",
                    )}
                  >
                    <item.icon
                      weight="bold"
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
    <div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
  </div>
);

export type { SettingsNavItem, SettingsNavSection };
