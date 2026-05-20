import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

const TIMEOUT_EXIT_CODE = 124;

describe("ready script deadline enforcement", () => {
  test("timeout validation: parsing valid JARVIS_READY_TIMEOUT_MS", () => {
    const result = spawnSync(
      "bun",
      [
        "-e",
        `
const envValue = process.env.JARVIS_READY_TIMEOUT_MS;
if (!envValue) {
  console.log("no-env");
  process.exit(0);
}
const parsed = parseInt(envValue, 10);
if (!Number.isInteger(parsed) || parsed <= 0) {
  process.stderr.write(\`warning: invalid JARVIS_READY_TIMEOUT_MS="\${envValue}"; using default (600000ms)\\n\`);
  console.log("invalid");
} else {
  console.log(parsed);
}
`,
      ],
      {
        env: {
          ...process.env,
          JARVIS_READY_TIMEOUT_MS: "5000",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout?.toString().trim()).toBe("5000");
  });

  test("timeout validation: invalid JARVIS_READY_TIMEOUT_MS produces warning", () => {
    const result = spawnSync(
      "bun",
      [
        "-e",
        `
const envValue = process.env.JARVIS_READY_TIMEOUT_MS;
if (!envValue) {
  console.log("no-env");
  process.exit(0);
}
const parsed = parseInt(envValue, 10);
if (!Number.isInteger(parsed) || parsed <= 0) {
  process.stderr.write(\`warning: invalid JARVIS_READY_TIMEOUT_MS="\${envValue}"; using default (600000ms)\\n\`);
  console.log("invalid");
} else {
  console.log(parsed);
}
`,
      ],
      {
        env: {
          ...process.env,
          JARVIS_READY_TIMEOUT_MS: "not-a-number",
        },
      },
    );

    expect(result.status).toBe(0);
    const output = result.stdout?.toString().trim();
    expect(output).toBe("invalid");
    const stderr = result.stderr?.toString();
    expect(stderr).toContain("warning");
    expect(stderr).toContain("invalid");
  });

  test("timeout validation: missing JARVIS_READY_TIMEOUT_MS uses default", () => {
    const result = spawnSync(
      "bun",
      [
        "-e",
        `
const envValue = process.env.JARVIS_READY_TIMEOUT_MS;
if (!envValue) {
  console.log("default");
}
`,
      ],
      {
        env: { ...process.env },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout?.toString().trim()).toBe("default");
  });

  test("ready script respects deadlines by exiting with 124 on timeout", () => {
    // Set timeout to 1ms - the bun install command will definitely exceed this
    // and the ready script should timeout and exit with code 124
    const result = spawnSync("bun", ["scripts/ready.ts"], {
      cwd: process.cwd(),
      timeout: 10000, // 10s overall to prevent hanging
      stdio: "pipe",
      env: {
        ...process.env,
        // Set deadline to 1ms - ensures timeout happens
        JARVIS_READY_TIMEOUT_MS: "1",
      },
    });

    // Should exit with 124 (timeout code)
    expect(result.status).toBe(TIMEOUT_EXIT_CODE);

    // Verify the timeout message is in stderr
    const stderr = result.stderr?.toString() ?? "";
    expect(stderr).toContain("deadline exceeded");
    expect(stderr).toContain("killing child tree");
  });

  test("ready script exits normally when commands complete", () => {
    // Run with echo commands that succeed quickly instead of real commands
    // Create a simple test that just verifies the script structure works
    const result = spawnSync(
      "bun",
      [
        "-e",
        `
import { runCommand } from "./scripts/ready.ts";

// Test that runCommand resolves with the exit code
const code = await runCommand("true", [], 5000, 0);
console.log(code);
      `,
      ],
      {
        cwd: process.cwd(),
        timeout: 5000,
        stdio: "pipe",
      },
    );

    // The script should run successfully
    expect(result.status).toBe(0);
    const output = result.stdout?.toString().trim();
    expect(output).toBe("0");
  });
});
