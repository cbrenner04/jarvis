import { parseArgs } from "node:util";
import packageJson from "../../package.json";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { callDaemonWithAutostart, ensureDaemonRunning, formatAutostartFailure } from "./daemon/autostart.ts";
import { callDaemon, tailDaemon } from "./daemon/client.ts";
import { daemonSocketPath, defaultJarvisRoot } from "./daemon/paths.ts";
import { fetchDaemonStatus, runDaemonServe } from "./daemon/server.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

type CliDeps = {
  executeWriteLoop: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[];
  ensureDaemonRunning: typeof ensureDaemonRunning;
  callDaemon: typeof callDaemon;
  callDaemonWithAutostart: typeof callDaemonWithAutostart;
  tailDaemon: typeof tailDaemon;
  fetchDaemonStatus: typeof fetchDaemonStatus;
  runDaemonServe: typeof runDaemonServe;
  jarvisRoot: () => string;
};

type WriteCliInput = { ok: true; input: WriteLoopInput; agents: readonly string[] } | { ok: false; message?: string };

const DEFAULT_STEP_RULES = "Return exactly one terminal token: done|no-work|blocked|progress.";
const DEFAULT_AGENTS = ["claude"] as const;
const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>] [--max-iterations <n>]\n";
const START_USAGE =
  "usage: jarvis start --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>] [--max-iterations <n>]\n";
const LOG_TAIL_USAGE = "usage: jarvis log-tail <run-id> [--from-seq <n>]\n";
const DAEMON_USAGE = "usage: jarvis daemon <start|stop|status|serve> [--jarvis-root <path>]\n";

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = {
    executeWriteLoop,
    createBindings: createAgentBindings,
    ensureDaemonRunning,
    callDaemon,
    callDaemonWithAutostart,
    tailDaemon,
    fetchDaemonStatus,
    runDaemonServe,
    jarvisRoot: defaultJarvisRoot,
    ...deps,
  };
  const command = argv[0];

  if (argv.length === 1 && command === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (command === "write") {
    const parsed = parseWriteCliInput(argv.slice(1), runtimeDeps);
    if (!parsed.ok) {
      if (parsed.message !== undefined) out.stderr(parsed.message);
      out.stderr(WRITE_USAGE);
      return 1;
    }

    const loopResult = await runtimeDeps.executeWriteLoop(parsed.input);

    out.stdout(
      `${JSON.stringify(
        {
          kind: loopResult.kind,
          runId: loopResult.runId,
          iterationsConsumed: loopResult.iterationsConsumed,
          resumable: loopResult.resumable,
        },
        null,
        2,
      )}\n`,
    );

    return exitCodeForWriteResult(loopResult.kind);
  }

  if (command === "start") {
    return runStartCli(argv.slice(1), out, runtimeDeps);
  }

  if (command === "status") {
    return runRunStatusCli(argv.slice(1), out, runtimeDeps);
  }

  if (command === "log-tail") {
    return runLogTailCli(argv.slice(1), out, runtimeDeps);
  }

  if (command === "daemon") {
    return runDaemonCli(argv.slice(1), out, runtimeDeps);
  }

  out.stdout("v2 not ready\n");
  return 0;
}

function parseWriteCliInput(argv: readonly string[], deps: CliDeps): WriteCliInput {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseWriteArgs(argv);
  } catch {
    return { ok: false };
  }

  const required = parseRequiredWriteValues(values);
  const agents = parseAgents(stringValue(values.agents));
  if (required === null || agents === null) return { ok: false };

  const maxIterations = parseMaxIterations(stringValue(values["max-iterations"]));
  if (maxIterations === null) {
    return { ok: false, message: "Error: --max-iterations must be a positive integer\n" };
  }

  const input: WriteLoopInput = {
    worktree: {
      projectRoot: required.projectRoot,
      projectName: required.projectName,
      branchName: required.branchName,
      baseRef: required.baseRef,
    },
    specPath: required.specPath,
    stepRules: DEFAULT_STEP_RULES,
    expectedArtifactPath: required.artifactPath,
    bindings: deps.createBindings(agents),
  };

  return maxIterations === undefined
    ? { ok: true, input, agents }
    : { ok: true, input: { ...input, maxIterations }, agents };
}

function parseWriteArgs(argv: readonly string[]): Record<string, string | boolean | string[] | undefined> {
  return parseArgs({
    args: [...argv],
    allowPositionals: false,
    strict: true,
    options: {
      "project-root": { type: "string" },
      project: { type: "string" },
      branch: { type: "string" },
      base: { type: "string" },
      spec: { type: "string" },
      artifact: { type: "string" },
      agents: { type: "string" },
      "max-iterations": { type: "string" },
    },
  }).values;
}

function parseRequiredWriteValues(values: Record<string, string | boolean | string[] | undefined>): {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
} | null {
  const projectRoot = stringValue(values["project-root"]);
  const projectName = stringValue(values.project);
  const branchName = stringValue(values.branch);
  const baseRef = stringValue(values.base);
  const specPath = stringValue(values.spec);
  const artifactPath = stringValue(values.artifact);

  if (
    projectRoot === undefined ||
    projectName === undefined ||
    branchName === undefined ||
    baseRef === undefined ||
    specPath === undefined ||
    artifactPath === undefined
  ) {
    return null;
  }

  return { projectRoot, projectName, branchName, baseRef, specPath, artifactPath };
}

function parseMaxIterations(raw: string | undefined): number | undefined | null {
  if (raw === undefined) return undefined;
  const maxIterations = parseInt(raw, 10);
  return Number.isNaN(maxIterations) || maxIterations < 1 ? null : maxIterations;
}

function exitCodeForWriteResult(kind: Awaited<ReturnType<typeof executeWriteLoop>>["kind"]): number {
  if (kind === "complete") return 0;
  if (kind === "invocation_failure") return 2;
  if (kind === "budget-exhausted") return 5;
  return 1;
}

function stringValue(value: string | boolean | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseAgents(raw: string | undefined): readonly string[] | null {
  if (raw === undefined) return DEFAULT_AGENTS;
  const agents = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return agents.length === 0 ? null : agents;
}

async function runDaemonCli(argv: readonly string[], out: Io, deps: CliDeps): Promise<number> {
  const subcommand = argv[0];
  const jarvisRoot = parseJarvisRoot(argv) ?? deps.jarvisRoot();
  const socketPath = daemonSocketPath(jarvisRoot);

  if (subcommand === "serve") {
    await deps.runDaemonServe({ socketPath });
    return 0;
  }

  if (subcommand === "start") {
    const started = await deps.ensureDaemonRunning({ jarvisRoot, socketPath });
    out.stdout(
      `${JSON.stringify(started.ok ? { started: true, socketPath } : formatAutostartFailure(started), null, 2)}\n`,
    );
    return started.ok ? 0 : 1;
  }

  if (subcommand === "status") {
    const status = await deps.fetchDaemonStatus(socketPath);
    out.stdout(`${JSON.stringify(status, null, 2)}\n`);
    return 0;
  }

  if (subcommand === "stop") {
    const response = await deps.callDaemon({ id: "stop", method: "stop" }, { socketPath });
    out.stdout(`${JSON.stringify(response, null, 2)}\n`);
    if (!response.ok && response.error?.code === "active_invocations") {
      return 1;
    }
    return response.ok ? 0 : 1;
  }

  out.stderr(DAEMON_USAGE);
  return 1;
}

function parseJarvisRoot(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--jarvis-root" && typeof argv[index + 1] === "string") {
      return argv[index + 1];
    }
  }
  return undefined;
}

async function runStartCli(argv: readonly string[], out: Io, deps: CliDeps): Promise<number> {
  const jarvisRoot = parseJarvisRoot(argv) ?? deps.jarvisRoot();
  const writeArgv = argv.filter((arg, index) => {
    if (arg === "--jarvis-root") return false;
    if (index > 0 && argv[index - 1] === "--jarvis-root") return false;
    return true;
  });
  const parsed = parseWriteCliInput(writeArgv, deps);
  if (!parsed.ok) {
    if (parsed.message !== undefined) out.stderr(parsed.message);
    out.stderr(START_USAGE);
    return 1;
  }

  const socketPath = daemonSocketPath(jarvisRoot);
  const input = parsed.input;
  const params: Record<string, unknown> = {
    projectRoot: input.worktree.projectRoot,
    project: input.worktree.projectName,
    branch: input.worktree.branchName,
    base: input.worktree.baseRef,
    spec: input.specPath,
    artifact: input.expectedArtifactPath,
    agents: [...parsed.agents],
  };
  if (input.maxIterations !== undefined) {
    params.maxIterations = input.maxIterations;
  }

  const response = await deps.callDaemonWithAutostart(
    { id: "run-start", method: "run.start", params },
    { jarvisRoot, socketPath },
  );
  out.stdout(`${JSON.stringify(response, null, 2)}\n`);
  return response.ok ? 0 : 1;
}

async function runRunStatusCli(argv: readonly string[], out: Io, deps: CliDeps): Promise<number> {
  const jarvisRoot = parseJarvisRoot(argv) ?? deps.jarvisRoot();
  const socketPath = daemonSocketPath(jarvisRoot);
  const response = await deps.callDaemonWithAutostart(
    { id: "run-list", method: "run.list" },
    { jarvisRoot, socketPath },
  );
  out.stdout(`${JSON.stringify(response, null, 2)}\n`);
  return response.ok ? 0 : 1;
}

async function runLogTailCli(argv: readonly string[], out: Io, deps: CliDeps): Promise<number> {
  const parsed = parseLogTailArgs(argv);
  if (!parsed.ok) {
    out.stderr(LOG_TAIL_USAGE);
    return 1;
  }

  const jarvisRoot = parseJarvisRoot(argv) ?? deps.jarvisRoot();
  const socketPath = daemonSocketPath(jarvisRoot);
  const autostart = await deps.callDaemonWithAutostart(
    { id: "log-tail-probe", method: "status" },
    { jarvisRoot, socketPath },
  );
  if (!autostart.ok) {
    out.stdout(`${JSON.stringify(autostart, null, 2)}\n`);
    return 1;
  }

  const params: { runId: string; fromSeq?: number } = { runId: parsed.runId };
  if (parsed.fromSeq !== undefined) {
    params.fromSeq = parsed.fromSeq;
  }

  const tail = deps.tailDaemon(params, {
    socketPath,
    timeoutMs: Number.POSITIVE_INFINITY,
    onRecord: (record) => {
      out.stdout(`${JSON.stringify(record)}\n`);
    },
  });

  await new Promise<void>((resolve) => {
    const onSignal = () => {
      tail.close();
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    void tail.done.finally(() => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    });
  });

  return 0;
}

function parseLogTailArgs(argv: readonly string[]): { ok: true; runId: string; fromSeq?: number } | { ok: false } {
  let runId: string | undefined;
  let fromSeq: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--jarvis-root") {
      index += 1;
      continue;
    }
    if (arg === "--from-seq") {
      const raw = argv[index + 1];
      if (typeof raw !== "string") return { ok: false };
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 0) return { ok: false };
      fromSeq = parsed;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) {
      return { ok: false };
    }
    if (runId === undefined && typeof arg === "string") {
      runId = arg;
    }
  }
  if (runId === undefined) return { ok: false };
  return fromSeq === undefined ? { ok: true, runId } : { ok: true, runId, fromSeq };
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
