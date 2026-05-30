import { defineCommand } from "citty";
import { Effect } from "effect";

import { runEffect } from "../lib/citty-effect";
import { InvalidArgumentError } from "../lib/exit-codes";
import { printHuman } from "../lib/output";

const TOP_LEVEL_COMMANDS = [
  "login",
  "logout",
  "init",
  "status",
  "projects",
  "branches",
  "channels",
  "build",
  "builds",
  "credentials",
  "env",
  "fingerprint",
  "update",
  "analytics",
  "audit-logs",
  "whoami",
  "open",
  "doctor",
  "devices",
  "webhooks",
  "autocomplete",
];

const bashScript = (): string => {
  const commands = TOP_LEVEL_COMMANDS.join(" ");
  return `_better_update_complete() {
  local cur prev
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commands}" -- "$cur") )
  fi
  return 0
}
complete -F _better_update_complete better-update
`;
};

const zshScript = (): string => {
  const commands = TOP_LEVEL_COMMANDS.map((cmd) => `"${cmd}"`).join(" ");
  return `#compdef better-update
_better_update() {
  local commands
  commands=(${commands})
  if (( CURRENT == 2 )); then
    _describe 'command' commands
  fi
}
compdef _better_update better-update
`;
};

const fishScript = (): string => {
  const lines = TOP_LEVEL_COMMANDS.map(
    (cmd) =>
      `complete -c better-update -f -n '__fish_use_subcommand' -a '${cmd}' -d '${cmd} subcommand'`,
  );
  return `${lines.join("\n")}\n`;
};

/** Render the completion script for a supported shell, or undefined if unknown. */
const renderScript = (shell: string): string | undefined => {
  switch (shell) {
    case "bash": {
      return bashScript();
    }
    case "zsh": {
      return zshScript();
    }
    case "fish": {
      return fishScript();
    }
    default: {
      return undefined;
    }
  }
};

export const autocompleteCommand = defineCommand({
  meta: {
    name: "autocomplete",
    description:
      "Print a shell completion script. Source it (or pipe to your rc file) to enable Tab-completion.",
  },
  args: {
    shell: {
      type: "positional",
      required: true,
      description: "Target shell: bash, zsh, or fish",
    },
  },
  run: async ({ args }) =>
    runEffect(
      Effect.gen(function* () {
        const script = renderScript(args.shell);
        if (script === undefined) {
          return yield* new InvalidArgumentError({
            message: `Unknown shell: ${args.shell}. Supported: bash, zsh, fish.`,
          });
        }
        yield* printHuman(script);
        return { shell: args.shell, script };
      }),
      { json: "value" },
    ),
});
