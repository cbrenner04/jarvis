import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createFileTuiRevisionReexecChannel,
  type TuiRevisionReexecChannel,
  type TuiRevisionReexecChannelPayload,
  TUI_REEXEC_CHANNEL_ENV,
  TUI_REVISION_REEXEC_EXIT_CODE,
} from "./tui-reexec-channel.ts";
import { buildTuiReexecEnv } from "./tui-revision-reexec.ts";

export {
  createInMemoryTuiRevisionReexecChannel,
  TUI_REVISION_REEXEC_EXIT_CODE,
} from "./tui-reexec-channel.ts";

/** Env marker: this `jarvis tui` process is a supervisor-spawned worker, not the supervisor. */
export const TUI_SUPERVISOR_WORKER_ENV = "JARVIS_TUI_SUPERVISOR_WORKER";

export function isTuiSupervisorWorker(env: NodeJS.ProcessEnv): boolean {
  return env[TUI_SUPERVISOR_WORKER_ENV] === "1";
}

/** Maps a spawned worker's exit code; signal termination (`null`) becomes `0`. */
export function tuiSupervisorWorkerExitCode(code: number | null): number {
  return code ?? 0;
}

function defaultChannelFilePath(): string {
  const dir = join(tmpdir(), "jarvis-tui-reexec");
  mkdirSync(dir, { recursive: true });
  return join(dir, randomUUID());
}

function workerSpawnEnv(
  supervisorBaseEnv: NodeJS.ProcessEnv,
  channelPath: string,
  reexec?: TuiRevisionReexecChannelPayload,
): NodeJS.ProcessEnv {
  const base =
    reexec !== undefined
      ? buildTuiReexecEnv(supervisorBaseEnv, reexec.daemonRevision, reexec.carriedState)
      : { ...supervisorBaseEnv };
  return {
    ...base,
    [TUI_SUPERVISOR_WORKER_ENV]: "1",
    [TUI_REEXEC_CHANNEL_ENV]: channelPath,
  };
}

export type TuiSupervisorSpawnWorker = (
  env: NodeJS.ProcessEnv,
  workerArgv: readonly string[],
) => Promise<number | null>;

export type RunTuiSupervisorParams = {
  argv: readonly string[];
  supervisorBaseEnv: NodeJS.ProcessEnv;
  spawnWorker?: TuiSupervisorSpawnWorker;
  channel?: TuiRevisionReexecChannel;
  channelFilePath?: string;
};

async function defaultSpawnWorker(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number | null> {
  const [executable, ...args] = argv;
  if (executable === undefined) throw new Error("cannot supervise: process.argv is empty");
  // guard-unbounded-subprocess: supervisor spawns the long-lived TUI worker; it respawns on revision re-exec
  const child = spawn(executable, args, { stdio: "inherit", env });
  return await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
}

/** Supervises `jarvis tui` monitor workers: respawns on {@link TUI_REVISION_REEXEC_EXIT_CODE}. */
export async function runTuiSupervisor(params: RunTuiSupervisorParams): Promise<number> {
  const channelFilePath = params.channelFilePath ?? defaultChannelFilePath();
  const channel = params.channel ?? createFileTuiRevisionReexecChannel(channelFilePath);
  let workerArgv = params.argv;
  const spawnWorker = params.spawnWorker ?? ((env, argv) => defaultSpawnWorker(argv, env));

  let workerEnv = workerSpawnEnv(params.supervisorBaseEnv, channelFilePath);

  for (;;) {
    const exitCode = await spawnWorker(workerEnv, workerArgv);
    if (exitCode === TUI_REVISION_REEXEC_EXIT_CODE) {
      const payload = channel.take();
      if (payload === undefined) return 1;
      if (payload.workerArgv !== undefined) {
        workerArgv = payload.workerArgv;
      }
      workerEnv = workerSpawnEnv(params.supervisorBaseEnv, channelFilePath, payload);
      continue;
    }
    return tuiSupervisorWorkerExitCode(exitCode);
  }
}
