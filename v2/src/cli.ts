import packageJson from "../../package.json";
import { createAgentBindings } from "../../shared/invocation/agents.ts";
import type { InvocationBinding } from "../../shared/invocation/execute.ts";
import { executeWrite, type WriteExecuteInput } from "./write.ts";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

type CliDeps = {
  executeWrite: (
    input: WriteExecuteInput,
  ) => Promise<Awaited<ReturnType<typeof executeWrite>>>;
  createBindings: (agentIds: readonly string[]) => readonly InvocationBinding[];
};

const DEFAULT_STEP_RULES =
  "Return exactly one terminal token: done|no-work|blocked|progress.";
const DEFAULT_AGENTS = ["claude"] as const;

export async function main(
  argv: readonly string[],
  io?: Io,
  deps?: Partial<CliDeps>,
): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = {
    executeWrite,
    createBindings: createAgentBindings,
    ...deps,
  };

  if (argv.length === 1 && argv[0] === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (argv[0] === "write") {
    const parsed = parseWriteArgs(argv.slice(1));
    if (parsed === null) {
      out.stderr(
        "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> [--agents <csv>]\n",
      );
      return 1;
    }

    const writeResult = await runtimeDeps.executeWrite({
      worktree: {
        projectRoot: parsed.projectRoot,
        projectName: parsed.projectName,
        branchName: parsed.branchName,
        baseRef: parsed.baseRef,
      },
      specPath: parsed.specPath,
      stepRules: DEFAULT_STEP_RULES,
      expectedArtifactPath: parsed.artifactPath,
      bindings: runtimeDeps.createBindings(parsed.agents),
    });

    out.stdout(
      `${JSON.stringify(
        {
          kind: writeResult.result.kind,
          worktreePath: writeResult.worktreePath,
          worktreeReused: writeResult.worktreeReused,
          lock: writeResult.lock.kind,
        },
        null,
        2,
      )}\n`,
    );
    return writeResult.result.kind === "complete" ? 0 : 1;
  }

  out.stdout("v2 not ready\n");
  return 0;
}

type ParsedWriteArgs = {
  projectRoot: string;
  projectName: string;
  branchName: string;
  baseRef: string;
  specPath: string;
  artifactPath: string;
  agents: readonly string[];
};

function parseWriteArgs(argv: readonly string[]): ParsedWriteArgs | null {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === undefined || !key.startsWith("--")) return null;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) return null;
    values[key.slice(2)] = value;
    i += 1;
  }

  const projectRoot = values["project-root"];
  const projectName = values.project;
  const branchName = values.branch;
  const baseRef = values.base;
  const specPath = values.spec;
  const artifactPath = values.artifact;
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
  const agents = parseAgents(values.agents);
  if (agents === null) return null;
  return {
    projectRoot,
    projectName,
    branchName,
    baseRef,
    specPath,
    artifactPath,
    agents,
  };
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
