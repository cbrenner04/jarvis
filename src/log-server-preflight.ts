import { createLogClient, type LogClient } from "./logging.ts";

export const DEFAULT_LOG_SERVER_URL = "http://127.0.0.1:4310/logs";

export type LogServerPreflightIo = {
  stderr: (s: string) => void;
};

export type LogServerPreflightOptions = {
  io: LogServerPreflightIo;
  /** Override the configured `logServerUrl`; falls back to the default. */
  logServerUrl?: string | undefined;
  /** Override the log client (for tests). */
  logClient?: LogClient;
};

export type LogServerPreflightResult =
  | { kind: "ok"; logClient: LogClient; logServerUrl: string }
  | { kind: "error"; exitCode: 1 };

/**
 * Verifies the local log server is reachable. On failure, writes the same
 * error wording shared by `jarvis run` and `jarvis plan` to stderr and
 * returns `{ kind: "error", exitCode: 1 }`.
 */
export async function checkLogServerReachable(
  opts: LogServerPreflightOptions,
): Promise<LogServerPreflightResult> {
  const logServerUrl = opts.logServerUrl ?? DEFAULT_LOG_SERVER_URL;
  const logClient = opts.logClient ?? createLogClient(logServerUrl);
  try {
    await logClient.assertReachable();
  } catch (err) {
    opts.io.stderr(
      `jarvis: log server unreachable at ${logServerUrl}. Start it with \`jarvis log-server\` or update config.\n`,
    );
    opts.io.stderr(`jarvis: ${(err as Error).message}\n`);
    return { kind: "error", exitCode: 1 };
  }
  return { kind: "ok", logClient, logServerUrl };
}
