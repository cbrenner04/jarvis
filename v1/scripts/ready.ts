import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const GRACE_PERIOD_MS = 5000; // 5 seconds for SIGTERM before SIGKILL
export const TIMEOUT_EXIT_CODE = 124; // Matches GNU timeout(1)

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

export function runCommand(
  name: string,
  args: string[],
  deadlineMs: number,
  elapsedMs: number,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(name, args, {
      detached: true,
      stdio: "inherit",
    });

    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      resolve(code);
    };

    const remainingMs = Math.max(0, deadlineMs - elapsedMs);

    const timeoutHandle = setTimeout(() => {
      if (!settled) {
        process.stderr.write(
          `ready: deadline exceeded after ${deadlineMs}ms; killing child tree\n`,
        );

        if (child.pid) {
          try {
            // Send SIGTERM to the process group (negative PID kills the group)
            process.kill(-child.pid, "SIGTERM");
          } catch (_err) {
            // Process may have already exited
          }
        }

        // Wait grace period then SIGKILL
        setTimeout(() => {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch (_err) {
              // Process may have already exited
            }
          }
        }, GRACE_PERIOD_MS).unref();

        settle(TIMEOUT_EXIT_CODE);
      }
    }, remainingMs);

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      settle(code ?? -1);
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
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
