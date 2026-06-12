import { parseArgs } from "node:util";
import packageJson from "../../package.json";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { executeWriteLoop, type WriteLoopInput } from "./write-loop.ts";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

type CliDeps = {
  executeWriteLoop: (input: WriteLoopInput) => Promise<Awaited<ReturnType<typeof executeWriteLoop>>>;
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[];
};

type WriteCliInput = { ok: true; input: WriteLoopInput } | { ok: false; message?: string };

const DEFAULT_STEP_RULES = "Return exactly one terminal token: done|no-work|blocked|progress.";
const DEFAULT_AGENTS = ["claude"] as const;
const WRITE_USAGE =
  "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>] [--max-iterations <n>]\n";

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = {
    executeWriteLoop,
    createBindings: createAgentBindings,
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
    projectId: required.projectName,
    specRef: required.baseRef,
    branch: required.branchName,
    specPath: required.specPath,
    stepRules: DEFAULT_STEP_RULES,
    expectedArtifactPath: required.artifactPath,
    bindings: deps.createBindings(agents),
  };

  return maxIterations === undefined ? { ok: true, input } : { ok: true, input: { ...input, maxIterations } };
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

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
