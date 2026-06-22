import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRunCommand, type RunCommandFn } from "./run-command.ts";

// Candidate list for conventional update-snapshots scripts (checked in order)
const UPDATE_SNAPSHOT_SCRIPT_CANDIDATES = ["test:update", "test:u", "update-snapshots", "updateSnapshots"];

/**
 * Resolve the update-snapshots command from config or by detecting a conventional
 * script in the target repo's root package.json.
 * Returns the command string or undefined if unresolvable.
 */
function resolveUpdateSnapshotsCommand(projectRoot: string, configCommand?: string): string | undefined {
  // Config field takes precedence
  if (configCommand !== undefined) {
    return configCommand;
  }

  // Try to detect a conventional script in root package.json
  const packageJsonPath = join(projectRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const content = readFileSync(packageJsonPath, "utf8");
    const pkg = JSON.parse(content);
    if (pkg.scripts && typeof pkg.scripts === "object") {
      // Check candidates in order
      for (const candidate of UPDATE_SNAPSHOT_SCRIPT_CANDIDATES) {
        if (candidate in pkg.scripts) {
          return `bun run ${candidate}`;
        }
      }
    }
  } catch {
    // Fail-safe: unparseable or missing package.json
  }

  return undefined;
}

/**
 * Run snapshot update + re-test in the agent working directory.
 * Resolves the update-snapshots command, runs it, then runs bun run test.
 * On re-test failure, retries serially once before returning non-green.
 * Returns true if re-test exits 0, false otherwise.
 * Emits distinct diagnostics on stderr for each non-green outcome.
 */
export async function runSnapshotUpdateRetest(
  agentWorkingDir: string,
  projectRoot: string,
  configCommand?: string,
  runCommandFn?: RunCommandFn,
): Promise<boolean> {
  const runCommand = runCommandFn ?? defaultRunCommand;
  const command = resolveUpdateSnapshotsCommand(projectRoot, configCommand);

  if (command === undefined) {
    console.error("[snapshot-churn] unresolvable update-snapshots command (no config field, no detected script)");
    return false;
  }

  // Tokenize command on whitespace: head + args
  const tokens = command.trim().split(/\s+/);
  const head = tokens[0];
  if (head === undefined || head === "") {
    console.error("[snapshot-churn] update command is empty after tokenization");
    return false;
  }
  const args = tokens.slice(1);

  // Run the update command in the agent working dir
  try {
    runCommand(head, args, agentWorkingDir);
  } catch {
    console.error("[snapshot-churn] update command failed or exited non-zero");
    return false;
  }

  // Helper to check if test files exist in the agent working dir
  const hasTestFiles = (): boolean => {
    try {
      const entries = readdirSync(agentWorkingDir, { recursive: true });
      for (const entry of entries) {
        if (typeof entry === "string" && entry.endsWith(".test.ts")) {
          return true;
        }
      }
    } catch {
      // If we can't read the directory, assume tests exist (fail-safe)
      return true;
    }
    return false;
  };

  // Re-run tests in the agent working dir
  let testPassed = false;
  try {
    runCommand("bun", ["run", "test"], agentWorkingDir);
    testPassed = true;
  } catch {
    // Parallel re-test failed; retry serially
    process.stderr.write(`snapshot-churn: parallel re-test failed; retrying serially\n`);
    try {
      runCommand("bun", ["test"], agentWorkingDir);
      process.stderr.write(`snapshot-churn: parallel-load flake recovered (serial re-test passed)\n`);
      testPassed = true;
    } catch {
      process.stderr.write(`snapshot-churn: serial re-test failed\n`);
      console.error("[snapshot-churn] re-test still failing after update");
      testPassed = false;
    }
    // Guard: if serial run passed but no test files were discovered,
    // treat as non-green to avoid incorrectly reporting snapshot update as successful
    if (testPassed && !hasTestFiles()) {
      testPassed = false;
    }
  }

  return testPassed;
}
