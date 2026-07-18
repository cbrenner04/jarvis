import packageJson from "../../package.json";
import type { CliDeps } from "./cli/deps.ts";
import { createRuntimeDeps } from "./cli/deps.ts";
import type { Io } from "./cli/io.ts";
import { WRITE_USAGE } from "./cli/usage.ts";
import { runCleanupCliCommand } from "./commands/cleanup-cli.ts";
import { runConfigCommand } from "./commands/config.ts";
import { runDaemonCommand } from "./commands/daemon.ts";
import { runRunCommand } from "./commands/run.ts";
import { runTuiCommand } from "./commands/tui.ts";
import { exitCodeForWriteResult, parseWriteCliInput, writeStdoutJson } from "./commands/write.ts";
import { resolveWriteLoopBindings } from "./daemon/daemon.ts";
import { applyOperatorSessionId } from "./execution/write-loop.ts";

export async function main(argv: readonly string[], io?: Io, deps?: Partial<CliDeps>): Promise<number> {
  const out = io ?? {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
  const runtimeDeps = createRuntimeDeps(deps);
  const command = argv[0];
  const operatorSessionId = crypto.randomUUID();

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

    const resolved = resolveWriteLoopBindings(parsed.input);
    if (!resolved.ok) {
      out.stderr(`${resolved.message}\n`);
      return 1;
    }

    const loopResult = await runtimeDeps.executeWriteLoop(applyOperatorSessionId(resolved.input, operatorSessionId));

    out.stdout(`${writeStdoutJson(loopResult)}\n`);

    return exitCodeForWriteResult(loopResult.kind);
  }

  if (command === "daemon") {
    return runDaemonCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "config") {
    return runConfigCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "run") {
    return runRunCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "tui") {
    return runTuiCommand(argv.slice(1), out, runtimeDeps);
  }

  if (command === "cleanup") {
    return runCleanupCliCommand(argv.slice(1), out, runtimeDeps);
  }

  out.stdout("v2 not ready\n");
  return 0;
}

if (import.meta.main) {
  // Harness git calls (push/fetch/ls-remote) against an HTTPS remote without
  // cached credentials would otherwise prompt on /dev/tty and hang the session.
  // Default to non-interactive so they fail fast; respect an explicit override.
  if (!process.env.GIT_TERMINAL_PROMPT) {
    process.env.GIT_TERMINAL_PROMPT = "0";
  }
  process.exit(await main(process.argv.slice(2)));
}
