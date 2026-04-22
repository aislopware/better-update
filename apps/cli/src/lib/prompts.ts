import { cancel, isCancel, password, select } from "@clack/prompts";

export const promptPassword = async (message: string): Promise<string> => {
  const value = await password({ message });
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    // eslint-disable-next-line eslint-plugin-unicorn/no-process-exit -- SIGINT at a CLI prompt must terminate the process; throwing would leave Effect runtime stuck
    process.exit(130);
  }
  return value;
};

type SelectOption<T> = Parameters<typeof select<T>>[0]["options"][number];

export const promptSelect = async <T>(
  message: string,
  options: readonly SelectOption<T>[],
): Promise<T> => {
  const value = await select<T>({ message, options: [...options] });
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    // eslint-disable-next-line eslint-plugin-unicorn/no-process-exit -- SIGINT at a CLI prompt must terminate the process; throwing would leave Effect runtime stuck
    process.exit(130);
  }
  return value;
};
