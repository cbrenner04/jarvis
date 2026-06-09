import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const GRACE_PERIOD_MS = 5000; // 5 seconds for SIGTERM before SIGKILL
export const TIMEOUT_EXIT_CODE = 124; // Matches GNU timeout(1)
const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

export function parseTimeout(): number {
  const envValue = process.env.JARVIS_READY_TIMEOUT_MS;
  if (!envValue) {
    return DEFAULT_TIMEOUT_MS;
  }

  const parsed = parseInt(envValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    process.stderr.write(
      `warning: invalid JARVIS_READY_TIMEOUT_MS="${envValue}"; using default (${DEFAULT_TIMEOUT_MS}ms)\n`,
    );
    return DEFAULT_TIMEOUT_MS;
  }

  return parsed;
}

export function runCommand(name: string, args: string[], deadlineMs: number, elapsedMs: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(name, args, {
      detached: true,
      stdio: "inherit",
    });

    let settled = false;
    let requestedExitCode: number | undefined;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    const remainingMs = Math.max(0, deadlineMs - elapsedMs);
    let forceKillHandle: NodeJS.Timeout | undefined;

    const killChildTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;

      try {
        process.kill(-child.pid, signal);
      } catch (_err) {
        // Process may have already exited
      }

      if (forceKillHandle) return;
      forceKillHandle = setTimeout(() => {
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch (_err) {
            // Process may have already exited
          }
        }
      }, GRACE_PERIOD_MS);
    };

    const onSignal = (signal: NodeJS.Signals) => {
      requestedExitCode = SIGNAL_EXIT_CODES[signal] ?? 1;
      killChildTree(signal);
    };

    const onSigint = () => onSignal("SIGINT");
    const onSigterm = () => onSignal("SIGTERM");

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      if (forceKillHandle) {
        clearTimeout(forceKillHandle);
      }
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        process.stderr.write(`ready: deadline exceeded after ${deadlineMs}ms; killing child tree\n`);
        requestedExitCode = TIMEOUT_EXIT_CODE;
        killChildTree("SIGTERM");
      }
    }, remainingMs);

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.on("close", (code) => {
      const signalExitCode = child.signalCode ? SIGNAL_EXIT_CODES[child.signalCode] : undefined;
      settle(requestedExitCode ?? signalExitCode ?? code ?? -1);
    });

    child.on("error", (err) => {
      process.stderr.write(`error spawning ${name}: ${String(err)}\n`);
      settle(-1);
    });
  });
}

export async function runReady(): Promise<void> {
  const timeoutMs = parseTimeout();
  const startTime = Date.now();

  const commands = [
    { name: "bun", args: ["install", "--frozen-lockfile"] },
    { name: "bun", args: ["run", "check:fix"] },
    { name: "bun", args: ["run", "typecheck"] },
    { name: "bun", args: ["run", "test"] },
    { name: "bun", args: ["run", "check"] },
  ];

  for (const { name, args } of commands) {
    const elapsed = Date.now() - startTime;
    const code = await runCommand(name, args, timeoutMs, elapsed);

    if (code !== 0) {
      process.exit(code);
    }
  }
}

if (import.meta.main) {
  runReady().catch((err) => {
    process.stderr.write(`fatal error: ${String(err)}\n`);
    process.exit(-1);
  });
}
