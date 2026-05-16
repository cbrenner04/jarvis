import type { Io } from "../cli.ts";
import { pricesEditCommand } from "./prices-edit.ts";
import { pricesShowCommand } from "./prices-show.ts";

const USAGE = `Usage: jarvis prices <subcommand> [args]

Subcommands:
  show              Display the pricing table.
  edit              Open prices.json in $EDITOR.
`;

export type PricesCommandOptions = {
  args: readonly string[];
  io: Io;
};

export function pricesCommand(opts: PricesCommandOptions): number {
  const { args, io } = opts;
  const [sub] = args;

  if (sub === undefined) {
    io.stderr(USAGE);
    return 1;
  }

  switch (sub) {
    case "show":
      return pricesShowCommand({ io });
    case "edit":
      return pricesEditCommand({ io });
    default:
      io.stderr(`jarvis: unknown prices subcommand ${JSON.stringify(sub)}\n`);
      io.stderr(USAGE);
      return 1;
  }
}
