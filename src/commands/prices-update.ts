import type { Io } from "../cli.ts";
import { runPricesUpdate } from "../prices/update.ts";

export type PricesUpdateCommandOptions = {
  io: Io;
};

export async function pricesUpdateCommand(
  opts: PricesUpdateCommandOptions,
): Promise<number> {
  return runPricesUpdate({ io: opts.io });
}
