import { CopyButton } from "../lib/copy-button";

/**
 * Copy-paste-ready CLI commands for empty states (Vercel/Expo first-run
 * pattern): the empty state's job is to teach the exact next command, not to
 * decorate. Rendered as a terminal panel — inverted chrome in both themes via
 * the dedicated `terminal` tokens.
 */
export const CliCommandBlock = ({ commands }: { commands: readonly string[] }) => (
  <div className="bg-terminal text-terminal-foreground dark:border-border flex flex-col gap-1 rounded-lg border border-transparent p-3 text-left shadow-2xs">
    {commands.map((command) => (
      <div key={command} className="group/cli flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs">
          <span aria-hidden className="text-terminal-foreground/50 select-none">
            ${" "}
          </span>
          {command}
        </code>
        <CopyButton
          value={command}
          label="Command"
          className="text-terminal-foreground/60 hover:bg-terminal-foreground/10 hover:text-terminal-foreground opacity-0 group-hover/cli:opacity-100 focus-visible:opacity-100"
        />
      </div>
    ))}
  </div>
);
