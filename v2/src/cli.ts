import packageJson from "../../package.json";
import { runWriteStep, type WriteStepDeps, type WriteStepResult } from "./write-step.ts";

export type Io = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export type CliDeps = WriteStepDeps;

function createDefaultDeps(): CliDeps {
  return {
    acquireWorktree: async () => ({ path: process.cwd(), release: () => {} }),
    invoke: async () => ({ kind: "error", stderr: "no agent adapter configured" }),
    checkOutputContract: async () => ({ ok: true }),
  };
}

function formatResult(result: WriteStepResult): string {
  switch (result.kind) {
    case "done":
    case "no-work":
    case "progress":
      return `${result.kind} ${result.worktreePath}`;
    case "blocked":
      return `blocked ${result.reason}`;
    case "error":
      return `error ${result.message}`;
  }
}

function parseWriteTask(argv: readonly string[]): string {
  const flagIndex = argv.indexOf("--task");
  if (flagIndex === -1) {
    return "Perform one write step for the active spec.";
  }
  return argv[flagIndex + 1] ?? "";
}

export async function main(
  argv: readonly string[],
  io?: Io,
  deps: CliDeps = createDefaultDeps(),
): Promise<number> {
  const out =
    io ??
    ({
      stdout: (s: string) => process.stdout.write(s),
      stderr: (s: string) => process.stderr.write(s),
    } satisfies Io);

  if (argv.length === 1 && argv[0] === "--version") {
    out.stdout(`${packageJson.version}\n`);
    return 0;
  }

  if (argv[0] !== "write") {
    out.stdout("usage: jarvis write [--task <text>]\n");
    return 1;
  }

  const result = await runWriteStep(
    {
      task: parseWriteTask(argv),
      signal: AbortSignal.timeout(5_000),
    },
    deps,
  );

  const line = `${formatResult(result)}\n`;
  if (result.kind === "error") {
    out.stderr(line);
    return 1;
  }

  out.stdout(line);
  return 0;
}

if (import.meta.main) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
