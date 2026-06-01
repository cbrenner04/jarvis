import { parseArgs } from "node:util";
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
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    values = parseArgs({
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
      },
    }).values;
  } catch {
    return null;
  }

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
  const agents = parseAgents(stringValue(values.agents));
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

function stringValue(
  value: string | boolean | string[] | undefined,
): string | undefined {
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
