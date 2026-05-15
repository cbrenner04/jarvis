import {
  checkLogServerReachable,
  DEFAULT_LOG_SERVER_URL,
} from "./log-server-preflight.ts";
import type { LogClient } from "./logging.ts";
import { type ResolveTargetRepoOptions, resolveTargetRepo } from "./repo.ts";

export type ModeEntryIo = {
  stderr: (s: string) => void;
};

export type ModeLogPreflightOptions = {
  io: ModeEntryIo;
  logServerUrl?: string | undefined;
  logClient?: LogClient | undefined;
};

export type ModeLogPreflightResult =
  | { kind: "ok"; logClient: LogClient; logServerUrl: string }
  | { kind: "error"; exitCode: 1 };

export async function runModeLogPreflight(
  opts: ModeLogPreflightOptions,
): Promise<ModeLogPreflightResult> {
  const preflightOpts: Parameters<typeof checkLogServerReachable>[0] = {
    io: { stderr: opts.io.stderr },
    logServerUrl: opts.logServerUrl ?? DEFAULT_LOG_SERVER_URL,
  };
  if (opts.logClient !== undefined) {
    preflightOpts.logClient = opts.logClient;
  }
  return await checkLogServerReachable(preflightOpts);
}

export type ModeEntryOptions = ResolveTargetRepoOptions &
  ModeLogPreflightOptions;

export type ModeEntryResult =
  | {
      kind: "ok";
      resolution: Extract<ReturnType<typeof resolveTargetRepo>, { kind: "ok" }>;
      logClient: LogClient;
      logServerUrl: string;
    }
  | Exclude<ReturnType<typeof resolveTargetRepo>, { kind: "ok" }>
  | { kind: "log-error"; exitCode: 1 };

export async function enterMode(
  opts: ModeEntryOptions,
): Promise<ModeEntryResult> {
  const resolution = resolveTargetRepo(opts);
  if (resolution.kind !== "ok") {
    return resolution;
  }
  const log = await runModeLogPreflight(opts);
  if (log.kind === "error") {
    return { kind: "log-error", exitCode: log.exitCode };
  }
  return {
    kind: "ok",
    resolution,
    logClient: log.logClient,
    logServerUrl: log.logServerUrl,
  };
}
