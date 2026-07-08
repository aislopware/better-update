import { CopyButton } from "../lib/copy-button";

/**
 * Copy-paste-ready CLI commands for empty states (Vercel/Expo first-run
 * pattern): the empty state's job is to teach the exact next command, not to
 * decorate.
 */
export const CliCommandBlock = ({ commands }: { commands: readonly string[] }) => (
  <div className="bg-muted/40 flex flex-col gap-1 rounded-md border p-3 text-left">
    {commands.map((command) => (
      <div key={command} className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs">{command}</code>
        <CopyButton value={command} label="Command" />
      </div>
    ))}
  </div>
);
