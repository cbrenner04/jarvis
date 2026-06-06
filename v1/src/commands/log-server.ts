import type { Io } from "../cli.ts";
import { type ConfigOptions, loadConfig } from "../config.ts";
import { runLogServer } from "../logging.ts";

export type LogServerCommandOptions = {
  io: Io;
  config?: ConfigOptions | undefined;
};

export async function logServerCommand(opts: LogServerCommandOptions): Promise<number> {
  const cfg = loadConfig(opts.config);
  return runLogServer({
    bind: cfg.logServerBind ?? "127.0.0.1:4310",
    stdout: opts.io.stdout,
    stderr: opts.io.stderr,
  });
}
