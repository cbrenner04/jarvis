import { writeFileSync } from "node:fs";
import { join } from "node:path";
import packageJson from "../../package.json";
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
};

const DEFAULT_STEP_RULES =
  "Return exactly one terminal token: done|no-work|blocked|progress.";

export async function main(
  argv: readonly string[],
  io?: Io,
  deps?: CliDeps,
): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps: CliDeps = deps ?? {
    executeWrite,
  };

  if (argv.length === 1 && argv[0] === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (argv[0] === "write") {
    const parsed = parseWriteArgs(argv.slice(1));
    if (parsed === null) {
      out.stderr(
        "usage: jarvis write --project-root <path> --project <name> --branch <name> --base <ref> --spec <path> --artifact <path> --agent-outcomes <csv> [--emit-artifact true]\n",
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
      bindings: createCliBindings(
        parsed.agentOutcomes,
        parsed.artifactPath,
        parsed.emitArtifact,
      ),
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
  agentOutcomes: readonly CliOutcome[];
  emitArtifact: boolean;
};

type CliOutcome =
  | "quota"
  | "model_config"
  | "error"
  | "done"
  | "no-work"
  | "blocked"
  | "progress";

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
  const agentOutcomes = parseAgentOutcomes(values["agent-outcomes"]);
  const emitArtifact = values["emit-artifact"] === "true";
  if (
    projectRoot === undefined ||
    projectName === undefined ||
    branchName === undefined ||
    baseRef === undefined ||
    specPath === undefined ||
    artifactPath === undefined ||
    agentOutcomes === null
  ) {
    return null;
  }
  return {
    projectRoot,
    projectName,
    branchName,
    baseRef,
    specPath,
    artifactPath,
    agentOutcomes,
    emitArtifact,
  };
}

function parseAgentOutcomes(
  raw: string | undefined,
): readonly CliOutcome[] | null {
  if (raw === undefined || raw.trim().length === 0) return null;
  const parsed: CliOutcome[] = [];
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (
      token !== "quota" &&
      token !== "model_config" &&
      token !== "error" &&
      token !== "done" &&
      token !== "no-work" &&
      token !== "blocked" &&
      token !== "progress"
    ) {
      return null;
    }
    parsed.push(token);
  }
  return parsed.length === 0 ? null : parsed;
}

function createCliBindings(
  outcomes: readonly CliOutcome[],
  artifactPath: string,
  emitArtifact: boolean,
): readonly InvocationBinding[] {
  return outcomes.map((outcome, index) => ({
    id: `cli.${index + 1}`,
    invoke: async ({ cwd }) => {
      if (outcome === "quota")
        return { kind: "quota", stderr: "quota" } as const;
      if (outcome === "model_config") {
        return { kind: "model_config", stderr: "model-config" } as const;
      }
      if (outcome === "error")
        return { kind: "error", exitCode: 1, stderr: "error" } as const;
      if (emitArtifact && (outcome === "done" || outcome === "no-work")) {
        writeFileSync(join(cwd, artifactPath), "ok\n", "utf8");
      }
      return { kind: "ok", stdout: outcome, stderr: "" } as const;
    },
  }));
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
