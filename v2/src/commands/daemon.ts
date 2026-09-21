import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { isProcessAlive } from "../../../shared/worktree-lock.ts";
import { DAEMON_LOG_PARSE_ARG_OPTIONS } from "../cli/command-help-flags.ts";
import type { CliDeps } from "../cli/deps.ts";
import type { Io } from "../cli/io.ts";
import { formatLifecycleError } from "../cli/ipc.ts";
import { DAEMON_LOG_USAGE, DAEMON_USAGE } from "../cli/usage.ts";
import { probeSocketLiveness, type SocketLiveness } from "../ipc/server.ts";

const DAEMON_DIGEST_ARTIFACT_FILE = /^daemon-([0-9a-f]{16})\.(sock|pid|log)$/;

/** The classifier's two probes, injectable so a test can exercise every branch without a real
 * process or a real bound socket. */
export type LegacyDaemonArtifactDeps = {
  isProcessAlive: (pid: number) => boolean;
  probeSocketLiveness: (socketPath: string) => Promise<SocketLiveness>;
};

const defaultLegacyDaemonArtifactDeps: LegacyDaemonArtifactDeps = { isProcessAlive, probeSocketLiveness };

type LegacyDaemonUnitPaths = { socketPath: string; pidPath: string; logPath: string };

function legacyDaemonUnitPaths(jarvisRoot: string, key: string): LegacyDaemonUnitPaths {
  return {
    socketPath: join(jarvisRoot, `daemon-${key}.sock`),
    pidPath: join(jarvisRoot, `daemon-${key}.pid`),
    logPath: join(jarvisRoot, `daemon-${key}.log`),
  };
}

/** Extracts the `daemon-<16hex>` key from every matching name (a bare filename, or a path whose
 * basename matches), deduplicated. Shared between directory-listing discovery and re-deriving
 * keys from a list of already-known dead-artifact paths. */
export function daemonUnitKeysFromNames(names: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    const key = DAEMON_DIGEST_ARTIFACT_FILE.exec(basename(name))?.[1];
    if (key !== undefined) keys.add(key);
  }
  return [...keys];
}

/** Union of keys across every `daemon-<16hex>.{sock,pid,log}` filename under `jarvisRoot`; a
 * socketless keyed PID/log pair is discovered the same as a keyed socket. */
function discoverLegacyDaemonUnitKeys(jarvisRoot: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(jarvisRoot);
  } catch {
    return [];
  }
  return daemonUnitKeysFromNames(entries);
}

/** A parseable positive PID, or undefined when the file is absent, unreadable, or not one. */
function parseLegacyDaemonPidFile(pidPath: string): number | undefined {
  if (!existsSync(pidPath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(pidPath, "utf-8").trim();
  } catch {
    return undefined;
  }
  const pid = Number.parseInt(raw, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

type LegacyDaemonUnitClassification = { status: "dead" } | { status: "preserved"; reason: string };

/**
 * Classify one legacy keyed unit without ever treating its socket as a live service endpoint: a
 * parseable PID file whose process is alive decides immediately (fail-closed on PID reuse — a
 * draining generation's private endpoint stays intact). Otherwise — PID dead, PID unparseable, or
 * no PID file — a keyed socket at the same key must independently prove death via a non-RPC
 * connect probe: only a `stale` (connection-refused) verdict is reapable, because a live successor
 * daemon can rebind a private socket at a recurring digest key while stale pre-fix PID residue
 * from an earlier generation survives at that same key. `absent` is not proof of death (a
 * sandboxed caller can see ENOENT for a live socket) and is preserved like `live`. A dead/absent
 * PID with no socket at all falls back to the PID verdict; a unit with neither has no proof of
 * death and is preserved as ambiguous.
 */
async function classifyLegacyDaemonUnit(
  unit: LegacyDaemonUnitPaths,
  deps: LegacyDaemonArtifactDeps,
): Promise<LegacyDaemonUnitClassification> {
  const pid = parseLegacyDaemonPidFile(unit.pidPath);
  if (pid !== undefined && deps.isProcessAlive(pid)) {
    return { status: "preserved", reason: `pid ${pid} is running` };
  }
  if (existsSync(unit.socketPath)) {
    const liveness = await deps.probeSocketLiveness(unit.socketPath);
    if (liveness === "stale") return { status: "dead" };
    return liveness === "live"
      ? { status: "preserved", reason: "socket is live" }
      : { status: "preserved", reason: "socket probe was inconclusive" };
  }
  if (pid !== undefined) return { status: "dead" };
  return { status: "preserved", reason: "no PID file or socket to prove death" };
}

export async function reapLegacyDaemonArtifacts(
  jarvisRoot: string,
  keys?: readonly string[],
  deps: LegacyDaemonArtifactDeps = defaultLegacyDaemonArtifactDeps,
): Promise<{ dead: string[]; preserved: Array<{ unit: string; reason: string }> }> {
  const dead: string[] = [];
  const preserved: Array<{ unit: string; reason: string }> = [];

  if (!existsSync(jarvisRoot)) {
    return { dead, preserved };
  }

  const unitKeys = keys ?? discoverLegacyDaemonUnitKeys(jarvisRoot);

  for (const key of unitKeys) {
    const unit = legacyDaemonUnitPaths(jarvisRoot, key);
    const classification = await classifyLegacyDaemonUnit(unit, deps);
    if (classification.status === "dead") {
      dead.push(...[unit.socketPath, unit.pidPath, unit.logPath].filter((path) => existsSync(path)));
    } else {
      preserved.push({ unit: `daemon-${key}`, reason: classification.reason });
    }
  }

  return { dead, preserved };
}

async function handleStopCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number | null> {
  if (!(argv.length === 1 || (argv.length === 2 && argv[1] === "--force"))) {
    return null;
  }
  try {
    const stopped = await deps.stopDaemon(deps.socketPath, { pidPath: deps.pidPath, force: argv[1] === "--force" });
    io.stdout("stopped\n");
    if (stopped !== undefined && stopped.reconciledRunIds.length > 0) {
      io.stdout(
        `reconciled ${stopped.reconciledRunIds.length} orphaned run(s): ${stopped.reconciledRunIds.join(", ")}\n`,
      );
    }
    return 0;
  } catch (error) {
    io.stderr(formatLifecycleError(error));
    return 1;
  }
}

export async function runDaemonCommand(argv: readonly string[], io: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];

  if (subcommand === "start" && argv.length === 1) {
    try {
      const result = await deps.startDaemon(deps.socketPath, {
        pidPath: deps.pidPath,
        logPath: deps.logPath,
        ...(deps.privateSocketPath === undefined ? {} : { privateSocketPath: deps.privateSocketPath }),
      });
      io.stdout(`${JSON.stringify(result)}\n`);
      return 0;
    } catch (error) {
      io.stderr(formatLifecycleError(error));
      return 1;
    }
  }

  if (subcommand === "stop") {
    const result = await handleStopCommand(argv, io, deps);
    if (result !== null) return result;
  }

  if (subcommand === "status" && argv.length === 1) {
    // A missing or stale pid file does not mean stopped: the socket probe is what decides.
    const status = await deps.getDaemonStatus(deps.socketPath);
    if (status.state === "stopped") {
      io.stdout("stopped\n");
      return 1;
    }
    if (status.state === "inconclusive") {
      io.stdout(
        `inconclusive: health request unanswered after ${status.healthTimeoutMs}ms and retry ${status.retryHealthTimeoutMs}ms; socket still accepts connections\n`,
      );
      return 1;
    }
    io.stdout(`running loaded=${status.loadedRevision}\n`);
    return 0;
  }

  if (subcommand === "log") {
    if (argv.length === 1) {
      return deps.readDaemonProcessLog(deps.logPath, { writeOut: io.stdout, writeErr: io.stderr });
    }
    let follow = false;
    try {
      follow =
        parseArgs({
          args: argv.slice(1),
          allowPositionals: false,
          strict: true,
          options: DAEMON_LOG_PARSE_ARG_OPTIONS,
        }).values.follow === true;
    } catch {
      io.stderr(DAEMON_LOG_USAGE);
      return 1;
    }
    if (follow) {
      const controller = new AbortController();
      const unregister = deps.onSigint(() => controller.abort());
      try {
        return await deps.followDaemonProcessLog(
          deps.logPath,
          { writeOut: io.stdout, writeErr: io.stderr },
          controller.signal,
        );
      } finally {
        unregister();
      }
    }
    io.stderr(DAEMON_LOG_USAGE);
    return 1;
  }

  io.stderr(DAEMON_USAGE);
  return 1;
}
