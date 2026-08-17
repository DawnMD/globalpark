export type ParsedCommand = { command: string; args: string[] };

/** Splits one line of REPL input into a command name and its arguments. */
export function parseCommand(line: string): ParsedCommand {
  const [command = "", ...args] = line.trim().split(/\s+/).filter(Boolean);
  return { command, args };
}
